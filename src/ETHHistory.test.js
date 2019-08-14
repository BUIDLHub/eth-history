import Hist from './';
import Web3 from 'web3';
import axios from 'axios';
import _ from 'lodash';

const dotenv = require("dotenv");
dotenv.config();

const KITTY_CORE = "0x06012c8cf97bead5deae237070f9587f8e7a266d";
const BASE_ABI_URL = "http://api.etherscan.io/api?module=contract&action=getabi&address=";

const getABI = async address => {
  let abiUrl = BASE_ABI_URL + address;
  let r = await axios.get(abiUrl);
  let res = _.get(r, "data.result");
  if(!res) {
    return null;
  }

  let abi = res;

  if(typeof res === 'string') {
    try {
      abi = JSON.parse(res);
    } catch (e) {
      return null;
    }
  }
  
  if(!abi.length) {
    return null;
  }
  return abi;
}

describe("ETHHistory", ()=>{
    let hist = null;
    let web3 = null;
    let currentBlock = 0;
    beforeEach(async ()=>{
        web3 = new Web3(new Web3.providers.HttpProvider(process.env.WEB3_URL));
        let abi = await getABI(KITTY_CORE);
        currentBlock = await web3.eth.getBlockNumber();
        hist = new Hist({
            web3,
            abi,
            targetAddress: KITTY_CORE
        });
    });

    it("Should recover a few blocks", done=>{
        
        let fromBlock = currentBlock-5;
        let count = 0;
        let last = 0;
        let cb = async (e, b) => {
            if(e) {
                console.log("Problem getting blocks", e);
            } else if(last !== b.number) {
                ++count;
                last = b.number;
            }
        }
        hist.recoverBlocks({
            fromBlock,
            toBlock: currentBlock,
            concurrency: 2
        }, cb).then(()=>{
            //blocks range is inclusive at both ends
            if(count !== 6) {
                return done(new Error("Expected 6 blocks but received: " + count));
            }
            done();
        }).catch(done);
        
        
    }).timeout(15000);

    it("Should recover blocks with receipts", done=>{
        let fromBlock = currentBlock-1;
        let count = 0;
        let cb = async (e, b) => {
            if(e) {
                console.log("Problem getting blocks", e);
            } else {
                count += b.transactions.reduce((i,t)=>{
                    if(t.receipt) {
                        return i+1;
                    }
                    return i;
                },0);
            }
        }
        hist.recoverBlocks({
            fromBlock,
            toBlock: currentBlock,
            concurrency: 2,
            includeReceipts: true
        }, cb).then(()=>{
            if(count === 0) {
                return done(new Error("Expected receipts to be attached to txns"));
            }
            done();
        }).catch(done);
    }).timeout(150000);

    it("Should recover events", done=>{
        let fromBlock = currentBlock-100;
        let count = 0;
        let cb = async (e, txns) => {
            if(e) {
                console.log("Problem getting events", e);
            } else {
                console.log("Events", txns.map(t=>_.keys(t.logEvents)));
                count += txns.length;
            }
        }
        hist.recoverEvents({
            fromBlock,
            toBlock: currentBlock
        }, cb).then(()=>{
            if(count === 0) {
                return done(new Error("Expected to get some events in 50 blocks"));
            }
            done();
        })
    }).timeout(30000);
});