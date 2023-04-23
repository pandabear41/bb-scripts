// import {
//     formatMoney, formatRam, formatDuration, formatDateTime, formatNumber,
//     hashCode, disableLogs, log, getFilePath, getConfiguration,
//     getNsDataThroughFile_Custom, runCommand_Custom, waitForProcessToComplete_Custom,
//     tryGetBitNodeMultipliers_Custom, getActiveSourceFiles_Custom,
//     getFnRunViaNsExec, autoRetry
// } from './helpers.js'


let options;
const argsSchema = [
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    const lastFlag = args.length > 1 ? args[args.length - 2] : null;
    if (lastFlag == "--disable-script" || lastFlag == "--run-script")
        return data.scripts;
    return [];
}

// --- CONSTANTS ---
// track how costly (in security) a growth/hacking thread is.
const growthThreadHardening = 0.004;
const hackThreadHardening = 0.002;
// initial potency of weaken threads before multipliers
const weakenThreadPotency = 0.05;
// unadjusted server growth rate, this is way more than what you actually get
const unadjustedGrowthRate = 1.03;
// max server growth rate, growth rates higher than this are throttled.
const maxGrowthRate = 1.0035;

// The maximum current total RAM utilization before we stop attempting to schedule work for the next less profitable server. Can be used to reserve capacity.
const maxUtilization = 0.95;
const lowUtilizationThreshold = 0.80; // The counterpart - low utilization, which leads us to ramp up targets
// If we have plenty of resources after targeting all possible servers, we can start to grow/weaken servers above our hack level - up to this utilization
const maxUtilizationPreppingAboveHackLevel = 0.75;
// Maximum number of milliseconds the main targeting loop should run before we take a break until the next loop
const maxLoopTime = 1000; //ms


// --- VARS ---
let loopInterval = 1000; //ms