export const solarShareAbi = [
  {
    type: "function",
    name: "participants",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [
      { name: "role", type: "uint8" },
      { name: "registered", type: "bool" }
    ]
  },
  {
    type: "function",
    name: "offers",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "id", type: "uint256" },
      { name: "seller", type: "address" },
      { name: "kWhAvailable", type: "uint256" },
      { name: "pricePerKWh", type: "uint256" },
      { name: "status", type: "uint8" }
    ]
  },
  {
    type: "function",
    name: "trades",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [
      { name: "id", type: "uint256" },
      { name: "offerId", type: "uint256" },
      { name: "seller", type: "address" },
      { name: "buyer", type: "address" },
      { name: "kWhTraded", type: "uint256" },
      { name: "totalPrice", type: "uint256" },
      { name: "status", type: "uint8" }
    ]
  },
  {
    type: "function",
    name: "nextOfferId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "nextTradeId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    type: "function",
    name: "registerParticipant",
    stateMutability: "nonpayable",
    inputs: [{ name: "role", type: "uint8" }],
    outputs: []
  },
  {
    type: "function",
    name: "createOffer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "kWhAvailable", type: "uint256" },
      { name: "pricePerKWh", type: "uint256" }
    ],
    outputs: [{ name: "offerId", type: "uint256" }]
  },
  {
    type: "function",
    name: "purchaseEnergy",
    stateMutability: "payable",
    inputs: [
      { name: "offerId", type: "uint256" },
      { name: "kWh", type: "uint256" }
    ],
    outputs: [{ name: "tradeId", type: "uint256" }]
  },
  {
    type: "function",
    name: "settleTrade",
    stateMutability: "nonpayable",
    inputs: [{ name: "tradeId", type: "uint256" }],
    outputs: []
  },
  {
    type: "function",
    name: "updateOfferPrice",
    stateMutability: "nonpayable",
    inputs: [
      { name: "offerId", type: "uint256" },
      { name: "newPricePerKWh", type: "uint256" }
    ],
    outputs: []
  },
  {
    type: "event",
    name: "ParticipantRegistered",
    inputs: [
      { name: "participant", type: "address", indexed: true },
      { name: "role", type: "uint8", indexed: false }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "OfferCreated",
    inputs: [
      { name: "offerId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "kWhAvailable", type: "uint256", indexed: false },
      { name: "pricePerKWh", type: "uint256", indexed: false }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "TradePurchased",
    inputs: [
      { name: "tradeId", type: "uint256", indexed: true },
      { name: "offerId", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "kWhTraded", type: "uint256", indexed: false },
      { name: "totalPrice", type: "uint256", indexed: false }
    ],
    anonymous: false
  },
  {
    type: "event",
    name: "TradeSettled",
    inputs: [
      { name: "tradeId", type: "uint256", indexed: true },
      { name: "offerId", type: "uint256", indexed: true },
      { name: "seller", type: "address", indexed: true },
      { name: "buyer", type: "address", indexed: false },
      { name: "totalPrice", type: "uint256", indexed: false }
    ],
    anonymous: false
  }
];
