
import { getActiveSourceFiles_Custom, checkNsInstance, getNsDataThroughFile } from './process.js'


/** @param {NS} ns
 * @returns {Promise<{ type: "COMPANY"|"FACTION"|"CLASS"|"CRIME", cyclesWorked: number, crimeType: string, classType: string, location: string, companyName: string, factionName: string, factionWorkType: string }>} */
export async function getCurrentWorkInfo(ns) {
    return (await getNsDataThroughFile(ns, 'ns.singularity.getCurrentWork()', '/Temp/getCurrentWork.txt')) ?? {};
}

/** @param {NS} ns 
 * Get a dictionary of active source files, taking into account the current active bitnode as well (optionally disabled). **/
export async function getActiveSourceFiles(ns, includeLevelsFromCurrentBitnode = true) {
    return await getActiveSourceFiles_Custom(ns, getNsDataThroughFile, includeLevelsFromCurrentBitnode);
}

/** @param {NS} ns 
 * @param {(ns: NS, command: string, fName?: string, args?: any, verbose?: any, maxRetries?: number, retryDelayMs?: number) => Promise<any>} fnGetNsDataThroughFile
 * getActiveSourceFiles Helper that allows the user to pass in their chosen implementation of getNsDataThroughFile to minimize RAM usage **/
export async function getActiveSourceFiles_Custom(ns, fnGetNsDataThroughFile, includeLevelsFromCurrentBitnode = true) {
    checkNsInstance(ns, '"getActiveSourceFiles"');
    // Find out what source files the user has unlocked
    let dictSourceFiles;
    try {
        dictSourceFiles = await fnGetNsDataThroughFile(ns,
            `Object.fromEntries(ns.singularity.getOwnedSourceFiles().map(sf => [sf.n, sf.lvl]))`,
            '/Temp/owned-source-files.txt');
    } catch { dictSourceFiles = {}; } // If this fails (e.g. low RAM), return an empty dictionary
    // If the user is currently in a given bitnode, they will have its features unlocked
    if (includeLevelsFromCurrentBitnode) {
        try {
            const bitNodeN = (await fnGetNsDataThroughFile(ns, 'ns.getPlayer()', '/Temp/player-info.txt')).bitNodeN;
            dictSourceFiles[bitNodeN] = Math.max(3, dictSourceFiles[bitNodeN] || 0);
        } catch { /* We are expected to be fault-tolerant in low-ram conditions */ }
    }
    return dictSourceFiles;
}

/** @param {NS} ns 
 * Return bitnode multiplers, or null if they cannot be accessed. **/
export async function tryGetBitNodeMultipliers(ns) {
    return await tryGetBitNodeMultipliers_Custom(ns, getNsDataThroughFile);
}

/** @param {NS} ns
 * tryGetBitNodeMultipliers Helper that allows the user to pass in their chosen implementation of getNsDataThroughFile to minimize RAM usage **/
export async function tryGetBitNodeMultipliers_Custom(ns, fnGetNsDataThroughFile) {
    checkNsInstance(ns, '"tryGetBitNodeMultipliers"');
    let canGetBitNodeMultipliers = false;
    try { canGetBitNodeMultipliers = 5 in (await getActiveSourceFiles_Custom(ns, fnGetNsDataThroughFile)); } catch { }
    if (!canGetBitNodeMultipliers) return null;
    try { return await fnGetNsDataThroughFile(ns, 'ns.getBitNodeMultipliers()', '/Temp/bitnode-multipliers.txt'); } catch { }
    return null;
}