// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @notice Test-only ERC20 with EIP-2612 permit, standing in for MUSD ("Mezo USD", 18 decimals).
contract MockPermitToken is ERC20, ERC20Permit {
    constructor() ERC20("Mezo USD", "MUSD") ERC20Permit("Mezo USD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
