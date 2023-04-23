
import { getNsDataThroughFile } from './process.js'


let cachedStockSymbols = null; // Cache of stock symbols since these never change

/** Helper function to get all stock symbols, or null if you do not have TIX api access.
 * Caches symbols the first time they are successfully requested, since symbols never change.
 * @param {NS} ns */
export async function getStockSymbols(ns) {
    cachedStockSymbols ??= await getNsDataThroughFile(ns,
        `(() => { try { return ns.stock.getSymbols(); } catch { return null; } })()`,
        '/Temp/stock-symbols.txt');
    return cachedStockSymbols;
}

/** Helper function to get the total value of stocks using as little RAM as possible.
 * @param {NS} ns */
export async function getStocksValue(ns) {
    let stockSymbols = await getStockSymbols(ns);
    if (stockSymbols == null) return 0; // No TIX API Access
    const helper = async (fn) => await getNsDataThroughFile(ns,
        `Object.fromEntries(ns.args.map(sym => [sym, ns.stock.${fn}(sym)]))`, `/Temp/stock-${fn}.txt`, stockSymbols);
    const askPrices = await helper('getAskPrice');
    const bidPrices = await helper('getBidPrice');
    const positions = await helper('getPosition');
    return stockSymbols.map(sym => ({ sym, pos: positions[sym], ask: askPrices[sym], bid: bidPrices[sym] }))
        .reduce((total, stk) => total + (stk.pos[0] * stk.bid) /* Long Value */ + stk.pos[2] * (stk.pos[3] * 2 - stk.ask) /* Short Value */
            // Subtract commission only if we have one or more shares (this is money we won't get when we sell our position)
            // If for some crazy reason we have shares both in the short and long position, we'll have to pay the commission twice (two separate sales)
            - 100000 * (Math.sign(stk.pos[0]) + Math.sign(stk.pos[2])), 0);
}