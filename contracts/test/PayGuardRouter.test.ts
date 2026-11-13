import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import type { MockPermitToken, PayGuardRouter } from "../typechain-types";

const ONE = 10n ** 18n;

/** Mirrors the off-chain convention documented in PayGuardRouter.sol. */
function invoiceRef(ref: string): string {
  const normalized = ref.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();
  return ethers.keccak256(ethers.toUtf8Bytes(normalized));
}

async function signPermit(
  token: MockPermitToken,
  owner: HardhatEthersSigner,
  spender: string,
  value: bigint,
  deadline: bigint,
) {
  const { chainId } = await ethers.provider.getNetwork();
  const nonce = await token.nonces(owner.address);
  const domain = {
    name: await token.name(),
    version: "1",
    chainId,
    verifyingContract: await token.getAddress(),
  };
  const types = {
    Permit: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const sig = await owner.signTypedData(domain, types, { owner: owner.address, spender, value, nonce, deadline });
  return ethers.Signature.from(sig);
}

async function deployFixture() {
  const [payer, recipient, payer2, stranger] = await ethers.getSigners();
  const token = (await ethers.deployContract("MockPermitToken")) as unknown as MockPermitToken;
  const router = (await ethers.deployContract("PayGuardRouter", [await token.getAddress()])) as unknown as PayGuardRouter;
  for (const s of [payer, payer2, stranger]) await token.mint(s.address, 1_000n * ONE);
  return { token, router, payer, recipient, payer2, stranger };
}

describe("PayGuardRouter", () => {
  describe("deployment", () => {
    it("stores the immutable token", async () => {
      const { token, router } = await loadFixture(deployFixture);
      expect(await router.token()).to.equal(await token.getAddress());
    });

    it("reverts with ZeroToken for a zero token address", async () => {
      const factory = await ethers.getContractFactory("PayGuardRouter");
      await expect(factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(factory, "ZeroToken");
    });
  });

  describe("pay", () => {
    it("moves tokens payer -> recipient, never holds funds, records and emits", async () => {
      const { token, router, payer, recipient } = await loadFixture(deployFixture);
      const amount = 25n * ONE;
      const ref = invoiceRef("INV-0042");
      const routerAddr = await router.getAddress();
      await token.connect(payer).approve(routerAddr, amount);

      const tx = router.connect(payer).pay(recipient.address, amount, ref);
      await expect(tx).to.changeTokenBalances(token, [payer, recipient, router], [-amount, amount, 0n]);
      await expect(tx)
        .to.emit(router, "InvoicePaid")
        .withArgs(payer.address, recipient.address, ref, amount, amount);

      expect(await token.balanceOf(routerAddr)).to.equal(0n);
      expect(await token.allowance(payer.address, routerAddr)).to.equal(0n); // exact approval fully consumed
      expect(await router.isPaid(payer.address, recipient.address, ref)).to.equal(true);
      const p = await router.getPayment(payer.address, recipient.address, ref);
      const block = await ethers.provider.getBlock("latest");
      expect(p.paid).to.equal(true);
      expect(p.amount).to.equal(amount);
      expect(p.paidAt).to.equal(BigInt(block!.timestamp));
      expect(p.blockNumber).to.equal(BigInt(block!.number));
      expect(await router.totalPaidTo(recipient.address, ref)).to.equal(amount);
      expect(await router.paymentCountTo(recipient.address, ref)).to.equal(1n);
      const key = await router.paymentKey(payer.address, recipient.address, ref);
      expect(key).to.equal(
        ethers.keccak256(
          ethers.AbiCoder.defaultAbiCoder().encode(["address", "address", "bytes32"], [payer.address, recipient.address, ref]),
        ),
      );
      const stored = await router.payments(key);
      expect(stored.amount).to.equal(amount);
    });

    it("reports unpaid triples as unpaid", async () => {
      const { router, payer, recipient } = await loadFixture(deployFixture);
      const ref = invoiceRef("INV-1");
      expect(await router.isPaid(payer.address, recipient.address, ref)).to.equal(false);
      const p = await router.getPayment(payer.address, recipient.address, ref);
      expect(p.paid).to.equal(false);
      expect(p.amount).to.equal(0n);
    });

    it("normalizes refs consistently with the documented convention", async () => {
      expect(invoiceRef("  inv-0042 ")).to.equal(invoiceRef("INV-0042"));
      expect(invoiceRef("inv  0042")).to.equal(invoiceRef("INV 0042"));
      expect(invoiceRef("INV-0042")).to.not.equal(invoiceRef("INV-0043"));
    });

    it("blocks a duplicate payment by the same payer for the same recipient + ref", async () => {
      const { token, router, payer, recipient } = await loadFixture(deployFixture);
      const ref = invoiceRef("INV-DUP");
      await token.connect(payer).approve(await router.getAddress(), 20n * ONE);
      await router.connect(payer).pay(recipient.address, 10n * ONE, ref);
      await expect(router.connect(payer).pay(recipient.address, 10n * ONE, ref))
        .to.be.revertedWithCustomError(router, "AlreadyPaid")
        .withArgs(payer.address, recipient.address, ref);
      // A differently formatted copy of the same ref normalizes to the same key and is also blocked.
      await expect(router.connect(payer).pay(recipient.address, 10n * ONE, invoiceRef(" inv-dup ")))
        .to.be.revertedWithCustomError(router, "AlreadyPaid");
    });

    it("allows the same payer to pay a different ref or a different recipient", async () => {
      const { token, router, payer, recipient, payer2 } = await loadFixture(deployFixture);
      await token.connect(payer).approve(await router.getAddress(), 30n * ONE);
      await router.connect(payer).pay(recipient.address, 10n * ONE, invoiceRef("A"));
      await expect(router.connect(payer).pay(recipient.address, 10n * ONE, invoiceRef("B"))).to.not.be.reverted;
      await expect(router.connect(payer).pay(payer2.address, 10n * ONE, invoiceRef("A"))).to.not.be.reverted;
    });

    it("allows a different payer to pay the same ref and aggregates per recipient", async () => {
      const { token, router, payer, payer2, recipient } = await loadFixture(deployFixture);
      const ref = invoiceRef("INV-SPLIT");
      const routerAddr = await router.getAddress();
      await token.connect(payer).approve(routerAddr, 40n * ONE);
      await token.connect(payer2).approve(routerAddr, 60n * ONE);
      await router.connect(payer).pay(recipient.address, 40n * ONE, ref);
      await expect(router.connect(payer2).pay(recipient.address, 60n * ONE, ref))
        .to.emit(router, "InvoicePaid")
        .withArgs(payer2.address, recipient.address, ref, 60n * ONE, 100n * ONE);
      expect(await router.totalPaidTo(recipient.address, ref)).to.equal(100n * ONE);
      expect(await router.paymentCountTo(recipient.address, ref)).to.equal(2n);
      expect(await router.isPaid(payer.address, recipient.address, ref)).to.equal(true);
      expect(await router.isPaid(payer2.address, recipient.address, ref)).to.equal(true);
    });

    it("griefing: a stranger's dust payment with the victim's ref does not block the real payer", async () => {
      const { token, router, payer, recipient, stranger } = await loadFixture(deployFixture);
      const ref = invoiceRef("INV-VICTIM");
      const routerAddr = await router.getAddress();
      await token.connect(stranger).approve(routerAddr, 1n);
      await router.connect(stranger).pay(recipient.address, 1n, ref); // front-run dust
      expect(await router.isPaid(payer.address, recipient.address, ref)).to.equal(false);

      await token.connect(payer).approve(routerAddr, 50n * ONE);
      await expect(router.connect(payer).pay(recipient.address, 50n * ONE, ref)).to.not.be.reverted;
      // Aggregate only grew by the dust: merchants compare totals against the invoice amount.
      expect(await router.totalPaidTo(recipient.address, ref)).to.equal(50n * ONE + 1n);
    });

    it("rejects a zero amount", async () => {
      const { router, payer, recipient } = await loadFixture(deployFixture);
      await expect(router.connect(payer).pay(recipient.address, 0n, invoiceRef("X"))).to.be.revertedWithCustomError(
        router,
        "ZeroAmount",
      );
    });

    it("rejects an empty invoice ref", async () => {
      const { router, payer, recipient } = await loadFixture(deployFixture);
      await expect(router.connect(payer).pay(recipient.address, ONE, ethers.ZeroHash)).to.be.revertedWithCustomError(
        router,
        "EmptyInvoiceRef",
      );
    });

    it("rejects invalid recipients: zero, router, token and self", async () => {
      const { token, router, payer } = await loadFixture(deployFixture);
      const routerAddr = await router.getAddress();
      const tokenAddr = await token.getAddress();
      await token.connect(payer).approve(routerAddr, 10n * ONE);
      for (const bad of [ethers.ZeroAddress, routerAddr, tokenAddr, payer.address]) {
        await expect(router.connect(payer).pay(bad, ONE, invoiceRef("BAD")))
          .to.be.revertedWithCustomError(router, "InvalidRecipient")
          .withArgs(bad);
      }
    });

    it("reverts without sufficient allowance (and records nothing)", async () => {
      const { token, router, payer, recipient } = await loadFixture(deployFixture);
      const ref = invoiceRef("INV-NOALLOW");
      await expect(router.connect(payer).pay(recipient.address, ONE, ref)).to.be.revertedWithCustomError(
        token,
        "ERC20InsufficientAllowance",
      );
      await token.connect(payer).approve(await router.getAddress(), ONE - 1n);
      await expect(router.connect(payer).pay(recipient.address, ONE, ref)).to.be.revertedWithCustomError(
        token,
        "ERC20InsufficientAllowance",
      );
      expect(await router.isPaid(payer.address, recipient.address, ref)).to.equal(false);
      expect(await router.totalPaidTo(recipient.address, ref)).to.equal(0n);
    });

    it("reverts with insufficient balance (and records nothing)", async () => {
      const { token, router, payer, recipient } = await loadFixture(deployFixture);
      const ref = invoiceRef("INV-BROKE");
      const tooMuch = 1_001n * ONE;
      await token.connect(payer).approve(await router.getAddress(), tooMuch);
      await expect(router.connect(payer).pay(recipient.address, tooMuch, ref)).to.be.revertedWithCustomError(
        token,
        "ERC20InsufficientBalance",
      );
      expect(await router.isPaid(payer.address, recipient.address, ref)).to.equal(false);
    });
  });

  describe("payWithPermit", () => {
    it("pays in one transaction with no prior approve and leaves no allowance", async () => {
      const { token, router, payer, recipient } = await loadFixture(deployFixture);
      const amount = 12n * ONE;
      const ref = invoiceRef("INV-PERMIT");
      const routerAddr = await router.getAddress();
      const deadline = BigInt(await time.latest()) + 3600n;
      expect(await token.allowance(payer.address, routerAddr)).to.equal(0n);
      const sig = await signPermit(token, payer, routerAddr, amount, deadline);

      const tx = router.connect(payer).payWithPermit(recipient.address, amount, ref, deadline, sig.v, sig.r, sig.s);
      await expect(tx).to.changeTokenBalances(token, [payer, recipient, router], [-amount, amount, 0n]);
      await expect(tx).to.emit(router, "InvoicePaid").withArgs(payer.address, recipient.address, ref, amount, amount);
      expect(await token.allowance(payer.address, routerAddr)).to.equal(0n);
      expect(await token.nonces(payer.address)).to.equal(1n);
      expect(await router.isPaid(payer.address, recipient.address, ref)).to.equal(true);
    });

    it("still succeeds when the permit signature was front-run", async () => {
      const { token, router, payer, recipient, stranger } = await loadFixture(deployFixture);
      const amount = 7n * ONE;
      const ref = invoiceRef("INV-FRONTRUN");
      const routerAddr = await router.getAddress();
      const deadline = BigInt(await time.latest()) + 3600n;
      const sig = await signPermit(token, payer, routerAddr, amount, deadline);
      // Attacker submits the permit first; the allowance now exists and the nonce is consumed.
      await token.connect(stranger).permit(payer.address, routerAddr, amount, deadline, sig.v, sig.r, sig.s);

      await expect(
        router.connect(payer).payWithPermit(recipient.address, amount, ref, deadline, sig.v, sig.r, sig.s),
      ).to.changeTokenBalances(token, [payer, recipient], [-amount, amount]);
      expect(await token.allowance(payer.address, routerAddr)).to.equal(0n);
    });

    it("reverts with an expired permit and no allowance", async () => {
      const { token, router, payer, recipient } = await loadFixture(deployFixture);
      const amount = 5n * ONE;
      const routerAddr = await router.getAddress();
      const deadline = BigInt(await time.latest()) - 1n;
      const sig = await signPermit(token, payer, routerAddr, amount, deadline);
      await expect(
        router.connect(payer).payWithPermit(recipient.address, amount, invoiceRef("INV-EXP"), deadline, sig.v, sig.r, sig.s),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("reverts with a permit signed by someone else and no allowance", async () => {
      const { token, router, payer, recipient, stranger } = await loadFixture(deployFixture);
      const amount = 5n * ONE;
      const routerAddr = await router.getAddress();
      const deadline = BigInt(await time.latest()) + 3600n;
      const sig = await signPermit(token, stranger, routerAddr, amount, deadline); // wrong signer
      await expect(
        router.connect(payer).payWithPermit(recipient.address, amount, invoiceRef("INV-BADSIG"), deadline, sig.v, sig.r, sig.s),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("reverts when the permit amount is lower than the payment amount", async () => {
      const { token, router, payer, recipient } = await loadFixture(deployFixture);
      const routerAddr = await router.getAddress();
      const deadline = BigInt(await time.latest()) + 3600n;
      const sig = await signPermit(token, payer, routerAddr, ONE, deadline); // signed for 1, paying 2
      await expect(
        router.connect(payer).payWithPermit(recipient.address, 2n * ONE, invoiceRef("INV-LOW"), deadline, sig.v, sig.r, sig.s),
      ).to.be.revertedWithCustomError(token, "ERC20InsufficientAllowance");
    });

    it("enforces the same duplicate protection and validation as pay", async () => {
      const { token, router, payer, recipient } = await loadFixture(deployFixture);
      const amount = 3n * ONE;
      const ref = invoiceRef("INV-PDUP");
      const routerAddr = await router.getAddress();
      let deadline = BigInt(await time.latest()) + 3600n;
      let sig = await signPermit(token, payer, routerAddr, amount, deadline);
      await router.connect(payer).payWithPermit(recipient.address, amount, ref, deadline, sig.v, sig.r, sig.s);

      deadline = BigInt(await time.latest()) + 3600n;
      sig = await signPermit(token, payer, routerAddr, amount, deadline);
      await expect(router.connect(payer).payWithPermit(recipient.address, amount, ref, deadline, sig.v, sig.r, sig.s))
        .to.be.revertedWithCustomError(router, "AlreadyPaid")
        .withArgs(payer.address, recipient.address, ref);
      await expect(
        router.connect(payer).payWithPermit(recipient.address, 0n, invoiceRef("Z"), deadline, sig.v, sig.r, sig.s),
      ).to.be.revertedWithCustomError(router, "ZeroAmount");
      await expect(
        router.connect(payer).payWithPermit(await token.getAddress(), amount, invoiceRef("T"), deadline, sig.v, sig.r, sig.s),
      ).to.be.revertedWithCustomError(router, "InvalidRecipient");
    });
  });

  describe("native currency", () => {
    it("rejects plain native transfers (no receive/fallback)", async () => {
      const { router, payer } = await loadFixture(deployFixture);
      await expect(payer.sendTransaction({ to: await router.getAddress(), value: 1n })).to.be.reverted;
      await expect(payer.sendTransaction({ to: await router.getAddress(), value: 1n, data: "0x12345678" })).to.be
        .reverted;
    });

    it("rejects value on pay (non-payable)", async () => {
      const { token, router, payer, recipient } = await loadFixture(deployFixture);
      await token.connect(payer).approve(await router.getAddress(), ONE);
      const data = router.interface.encodeFunctionData("pay", [recipient.address, ONE, invoiceRef("V")]);
      await expect(payer.sendTransaction({ to: await router.getAddress(), data, value: 1n })).to.be.reverted;
      expect(await ethers.provider.getBalance(await router.getAddress())).to.equal(0n);
    });
  });

  describe("gas (informational)", () => {
    it("measures gas for pay and payWithPermit", async () => {
      const { token, router, payer, recipient, payer2 } = await loadFixture(deployFixture);
      const routerAddr = await router.getAddress();
      await token.connect(payer).approve(routerAddr, 10n * ONE);
      // First payment to a fresh recipient (cold token balance slot) via pay().
      const r1 = await (await router.connect(payer).pay(recipient.address, 10n * ONE, invoiceRef("G1"))).wait();
      const deadline = BigInt(await time.latest()) + 3600n;
      const sig = await signPermit(token, payer2, routerAddr, 10n * ONE, deadline);
      const r2 = await (
        await router.connect(payer2).payWithPermit(recipient.address, 10n * ONE, invoiceRef("G2"), deadline, sig.v, sig.r, sig.s)
      ).wait();
      console.log(`      gas pay(): ${r1!.gasUsed}  payWithPermit(): ${r2!.gasUsed}`);
      expect(r1!.gasUsed).to.be.lessThan(250_000n);
      expect(r2!.gasUsed).to.be.lessThan(300_000n);
    });
  });
});
