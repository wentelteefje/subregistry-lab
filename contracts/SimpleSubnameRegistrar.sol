// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// NOTE: This file is the contract from the docs tutorial
// "For Contract Developers" (tutorial-contract-developers.mdx),
// reassembled verbatim from its code blocks, including the import paths
// (resolved here via the remappings in foundry.toml, which point at the
// local contracts-v2 checkout). Keep in sync with the tutorial.

import {SafeERC20, IERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPermissionedRegistry} from "@ensdomains/contracts-v2/registry/interfaces/IPermissionedRegistry.sol";
import {IRegistry} from "@ensdomains/contracts-v2/registry/interfaces/IRegistry.sol";
import {RegistryRolesLib} from "@ensdomains/contracts-v2/registry/libraries/RegistryRolesLib.sol";

uint256 constant REGISTRATION_ROLE_BITMAP =
    RegistryRolesLib.ROLE_SET_SUBREGISTRY
    | RegistryRolesLib.ROLE_SET_SUBREGISTRY_ADMIN
    | RegistryRolesLib.ROLE_SET_RESOLVER
    | RegistryRolesLib.ROLE_SET_RESOLVER_ADMIN
    | RegistryRolesLib.ROLE_CAN_TRANSFER_ADMIN;

contract SimpleSubnameRegistrar {
    using SafeERC20 for IERC20;

    error NameNotAvailable(string label);
    error NameNotRegistered(string label);
    error InvalidOwner();
    error DurationTooShort(uint64 duration, uint64 minimum);

    event NameRegistered(
        uint256 indexed tokenId, string label, address owner,
        uint64 duration, uint256 price
    );
    event NameRenewed(
        uint256 indexed tokenId, string label,
        uint64 duration, uint64 newExpiry, uint256 price
    );

    IPermissionedRegistry public immutable REGISTRY;
    IERC20 public immutable PAYMENT_TOKEN;
    address public immutable BENEFICIARY;
    uint256 public immutable PRICE;
    uint64 public immutable MIN_DURATION;

    constructor(
        IPermissionedRegistry registry,
        IERC20 paymentToken,
        address beneficiary,
        uint256 price,
        uint64 minDuration
    ) {
        REGISTRY = registry;
        PAYMENT_TOKEN = paymentToken;
        BENEFICIARY = beneficiary;
        PRICE = price;
        MIN_DURATION = minDuration;
    }

    function isAvailable(string calldata label) public view returns (bool) {
        IPermissionedRegistry.State memory state =
            REGISTRY.getState(uint256(keccak256(bytes(label))));
        return state.status == IPermissionedRegistry.Status.AVAILABLE;
    }

    function getPrice(uint64 duration) public view returns (uint256) {
        return PRICE * duration / 365 days;
    }

    function register(
        string calldata label,
        address owner,
        address resolver,
        uint64 duration
    ) external returns (uint256 tokenId) {
        if (!isAvailable(label)) revert NameNotAvailable(label);
        if (owner == address(0)) revert InvalidOwner();
        if (duration < MIN_DURATION) revert DurationTooShort(duration, MIN_DURATION);

        uint256 price = getPrice(duration);
        PAYMENT_TOKEN.safeTransferFrom(msg.sender, BENEFICIARY, price);

        tokenId = REGISTRY.register(
            label,
            owner,
            IRegistry(address(0)),
            resolver,
            REGISTRATION_ROLE_BITMAP,
            uint64(block.timestamp) + duration
        );

        emit NameRegistered(tokenId, label, owner, duration, price);
    }

    function renew(string calldata label, uint64 duration) external {
        if (duration < MIN_DURATION) revert DurationTooShort(duration, MIN_DURATION);

        uint256 labelId = uint256(keccak256(bytes(label)));
        IPermissionedRegistry.State memory state = REGISTRY.getState(labelId);

        if (state.status != IPermissionedRegistry.Status.REGISTERED) {
            revert NameNotRegistered(label);
        }

        uint256 price = getPrice(duration);
        PAYMENT_TOKEN.safeTransferFrom(msg.sender, BENEFICIARY, price);

        uint64 newExpiry = state.expiry + duration;
        REGISTRY.renew(labelId, newExpiry);

        emit NameRenewed(state.tokenId, label, duration, newExpiry, price);
    }
}
