# eth-history
Utility for retrieving/replaying historical blocks/events for a specific contract address.

# Motivation
Sometimes it's good to have a simple utility that recovers historical block and/or event data in a robust way. This utility will retrieve all blocks/events in the requested range and make retries upon failure or empty results. This is useful when using Infura or other managed RPC platform where failures and/or timeouts are common.

# Installation
npm install eth-history

# Usage
```javascript
let hist = new ETHHistory({
    web3: <web3-instance>,
    targetAddress: <contract_address>,
    abi: <abi array>
});

let cb = async (e, block) => {
   //log error or handle recovered block
}

//upon completion, callback should have been given all recovered blocks
await hist.recoverBlocks({
   fromBlock: <starting block number>,
   toBlock: <end block number>
}, cb);

//we could also get historical events
let evtHandler = (e, txns) => {
   //txns will be a bundle of information for each matching block where events were found. The txns will be 
   //contained in a 'logEvents' map where each event name maps to an array of event metadata.
}

//this will retrieve all events in the given block range, regardless of how many events are available. It uses eth-sync utility to incrementally retrieve block ranges until all events retrieved (i.e. it works around Infura limits if using Infura as an RPC provider).
await hist.recoverEvents({
    fromBlock: <start block>,
    toBlock: <end block>
}, evtHandler);
```
