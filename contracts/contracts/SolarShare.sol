// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract SolarShare {
    enum ParticipantRole {
        None,
        Prosumer,
        Consumer,
        Both
    }

    enum OfferStatus {
        Open,
        Matched,
        Settled
    }

    enum TradeStatus {
        Pending,
        Settled
    }

    struct Participant {
        ParticipantRole role;
        bool registered;
    }

    struct Offer {
        uint256 id;
        address seller;
        uint256 kWhAvailable;
        uint256 pricePerKWh;
        OfferStatus status;
    }

    struct Trade {
        uint256 id;
        uint256 offerId;
        address seller;
        address buyer;
        uint256 kWhTraded;
        uint256 totalPrice;
        TradeStatus status;
    }

    uint8 public constant PROSUMER = 1;
    uint8 public constant CONSUMER = 2;
    uint8 public constant BOTH = 3;

    uint256 public nextOfferId;
    uint256 public nextTradeId;

    mapping(address => Participant) public participants;
    mapping(uint256 => Offer) public offers;
    mapping(uint256 => Trade) public trades;

    error InvalidRole();
    error AlreadyRegistered();
    error NotRegistered();
    error NotProsumer();
    error NotConsumer();
    error InvalidAmount();
    error OfferUnavailable();
    error CannotBuyOwnOffer();
    error IncorrectPayment();
    error NotSeller();
    error NotBuyer();
    error TradeAlreadySettled();
    error TransferFailed();
    error OfferAlreadyMatched();

    event ParticipantRegistered(address indexed participant, ParticipantRole role);
    event OfferCreated(
        uint256 indexed offerId,
        address indexed seller,
        uint256 kWhAvailable,
        uint256 pricePerKWh
    );
    event TradePurchased(
        uint256 indexed tradeId,
        uint256 indexed offerId,
        address indexed buyer,
        uint256 kWhTraded,
        uint256 totalPrice
    );
    event TradeSettled(
        uint256 indexed tradeId,
        uint256 indexed offerId,
        address indexed seller,
        address buyer,
        uint256 totalPrice
    );

    function registerParticipant(uint8 role) external {
        if (role < PROSUMER || role > BOTH) revert InvalidRole();
        if (participants[msg.sender].registered) revert AlreadyRegistered();

        ParticipantRole participantRole = ParticipantRole(role);
        participants[msg.sender] = Participant({
            role: participantRole,
            registered: true
        });
        emit ParticipantRegistered(msg.sender, participantRole);
    }

    function createOffer(uint256 kWhAvailable, uint256 pricePerKWh)
        external
        returns (uint256 offerId)
    {
        _requireProsumer(msg.sender);
        if (kWhAvailable == 0 || pricePerKWh == 0) revert InvalidAmount();

        offerId = nextOfferId++;
        offers[offerId] = Offer({
            id: offerId,
            seller: msg.sender,
            kWhAvailable: kWhAvailable,
            pricePerKWh: pricePerKWh,
            status: OfferStatus.Open
        });
        emit OfferCreated(offerId, msg.sender, kWhAvailable, pricePerKWh);
    }

    function purchaseEnergy(uint256 offerId, uint256 kWh)
        external
        payable
        returns (uint256 tradeId)
    {
        _requireConsumer(msg.sender);
        Offer storage offer = offers[offerId];
        if (offer.kWhAvailable == 0 || offer.status == OfferStatus.Settled) {
            revert OfferUnavailable();
        }
        if (offer.seller == msg.sender) revert CannotBuyOwnOffer();
        if (kWh == 0 || kWh > offer.kWhAvailable) revert InvalidAmount();

        uint256 totalPrice = kWh * offer.pricePerKWh;
        if (msg.value != totalPrice) revert IncorrectPayment();

        offer.kWhAvailable -= kWh;
        offer.status = OfferStatus.Matched;
        tradeId = nextTradeId++;
        trades[tradeId] = Trade({
            id: tradeId,
            offerId: offerId,
            seller: offer.seller,
            buyer: msg.sender,
            kWhTraded: kWh,
            totalPrice: totalPrice,
            status: TradeStatus.Pending
        });
        emit TradePurchased(tradeId, offerId, msg.sender, kWh, totalPrice);
    }

    function updateOfferPrice(uint256 offerId, uint256 newPricePerKWh) external {
        Offer storage offer = offers[offerId];
        if (offer.seller == address(0)) revert OfferUnavailable();
        if (msg.sender != offer.seller) revert NotSeller();
        if (offer.status != OfferStatus.Open) revert OfferAlreadyMatched();
        if (newPricePerKWh == 0) revert InvalidAmount();
        offer.pricePerKWh = newPricePerKWh;
    }

    function settleTrade(uint256 tradeId) external {
        Trade storage trade = trades[tradeId];
        if (trade.seller == address(0)) revert OfferUnavailable();
        if (msg.sender != trade.seller) revert NotSeller();
        if (trade.status == TradeStatus.Settled) revert TradeAlreadySettled();

        trade.status = TradeStatus.Settled;
        Offer storage offer = offers[trade.offerId];
        if (offer.kWhAvailable == 0) offer.status = OfferStatus.Settled;

        (bool sent, ) = payable(trade.seller).call{value: trade.totalPrice}("");
        if (!sent) revert TransferFailed();
        emit TradeSettled(
            tradeId,
            trade.offerId,
            trade.seller,
            trade.buyer,
            trade.totalPrice
        );
    }

    function _requireProsumer(address participant) internal view {
        if (!participants[participant].registered) revert NotRegistered();
        ParticipantRole role = participants[participant].role;
        if (role != ParticipantRole.Prosumer && role != ParticipantRole.Both) {
            revert NotProsumer();
        }
    }

    function _requireConsumer(address participant) internal view {
        if (!participants[participant].registered) revert NotRegistered();
        ParticipantRole role = participants[participant].role;
        if (role != ParticipantRole.Consumer && role != ParticipantRole.Both) {
            revert NotConsumer();
        }
    }
}
