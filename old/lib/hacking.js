import { filesExist } from "./filesystem.js";
import { getNsDataThroughFile } from "./process.js";
import { hashCode } from "./variables.js";


// Returns the amount of money we should currently be reserving. Dynamically adapts to save money for a couple of big purchases on the horizon
export function reservedMoney(ns) {
    let shouldReserve = Number(ns.read("reserve.txt") || 0);
    let playerMoney = ns.getServerMoneyAvailable("home");
    if (ownedCracks.length == 0) updatePortCrackers(ns);
    if (!ownedCracks.includes("SQLInject.exe") && playerMoney > 200e6)
        shouldReserve += 250e6; // Start saving at 200m of the 250m required for SQLInject
    const fourSigmaCost = (bitnodeMults.FourSigmaMarketDataApiCost * 25000000000);
    if (!have4sApi && playerMoney >= fourSigmaCost / 2)
        shouldReserve += fourSigmaCost; // Start saving if we're half-way to buying 4S market access
    return shouldReserve;
}

const crackNames = ["BruteSSH.exe", "FTPCrack.exe", "relaySMTP.exe", "HTTPWorm.exe", "SQLInject.exe"];
let ownedCracks = [];

/** Determine which port crackers we own
 * @param {NS} ns */
export async function updatePortCrackers(ns) {
    const owned = await filesExist(ns, crackNames);
    ownedCracks = crackNames.filter((s, i) => owned[i]);
}

export async function getOwnedCracks(ns) {
    if (ownedCracks.length == 0) await updatePortCrackers(ns);
    return ownedCracks;
}

let toolsByShortName = (/**@returns{{[id: string]: Tool;}}*/() => undefined)(); // Dictionary of tools keyed by tool short name
/** @param {NS} ns
 * @param {({name: string; shortName: string; shouldRun: () => Promise<boolean>; args: string[]; tail: boolean; requiredServer: string; threadSpreadingAllowed: boolean; })[]} allTools **/
export async function buildToolkit(ns, allTools) {
    log(ns, "buildToolkit");
    let toolCosts = await getNsDataThroughFile(ns, `Object.fromEntries(ns.args.map(s => [s, ns.getScriptRam(s, 'home')]))`,
        '/Temp/script-costs.txt', allTools.map(t => t.name));
    const toolsTyped = allTools.map(toolConfig => new Tool(toolConfig, toolCosts[toolConfig.name]));
    toolsByShortName = Object.fromEntries(toolsTyped.map(tool => [tool.shortName || hashToolDefinition(tool), tool]));
    await updatePortCrackers(ns);
    return toolsTyped;
}


/** @returns {string} */
const hashToolDefinition = s => hashCode(s.name + (s.args?.toString() || ''));

/** @returns {Tool} */
export function getTool(s) {
    //return tools.find(t => t.shortName == (s.shortName || s) || hashToolDefinition(t) == hashToolDefinition(s))
    return toolsByShortName[s] || toolsByShortName[s.shortName || hashToolDefinition(s)];
}

