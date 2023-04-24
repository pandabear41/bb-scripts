// import {
//     formatMoney, formatRam, formatDuration, formatDateTime, formatNumber,
//     hashCode, disableLogs, log, getFilePath, getConfiguration,
//     getNsDataThroughFile_Custom, runCommand_Custom, waitForProcessToComplete_Custom,
//     tryGetBitNodeMultipliers_Custom, getActiveSourceFiles_Custom,
//     getFnRunViaNsExec, autoRetry
// } from './helpers.js'

import { getConfiguration } from './lib/filesystem.js'
import { waitForProcessToComplete_Custom, processList, killProcessIds, getNsDataThroughFile, runCommand } from './lib/process.js';
import { disableLogs } from './lib/logs.js';
import { buildToolkit } from './lib/hacking.js';

let options;
const argsSchema = [
    ['h', false], // Do nothing but hack, no prepping (drains servers to 0 money, if you want to do that for some reason)
    ['hack-only', false], // Same as above
    ['s', true], // Enable Stock Manipulation. This is now true for default, but left as a valid argument for backwards-compatibility.
    ['stock-manipulation', true], // Same as above
    ['disable-stock-manipulation', false], // You must now opt *out* of stock-manipulation mode by enabling this flag.
    ['stock-manipulation-focus', false], // Stocks are main source of income - kill any scripts that would do them harm (TODO: Enable automatically in BN8)
    ['v', false], // Detailed logs about batch scheduling / tuning
    ['verbose', false], // Same as above
    ['o', false], // Good for debugging, run the main targettomg loop once then stop, with some extra logs
    ['run-once', false], // Same as above
    ['x', false], // Focus on a strategy that produces the most hack EXP rather than money
    ['xp-only', false], // Same as above
    ['n', false], // Can toggle on using hacknet nodes for extra hacking ram (at the expense of hash production)
    ['use-hacknet-nodes', false], // Same as above (kept for backwards compatibility, but these are now called hacknet-servers)
    ['use-hacknet-servers', false], // Same as above, but the game recently renamed these
    ['spend-hashes-for-money-when-under', 10E6], // (Default 10m) Convert 4 hashes to money whenever we're below this amount
    ['disable-spend-hashes', false], // An easy way to set the above to a very large negative number, thus never spending hashes for Money
    ['silent-misfires', false], // Instruct remote scripts not to alert when they misfire
    ['initial-max-targets', 2], // Initial number of servers to target / prep (TODO: Scale this as BN progression increases)
    ['max-steal-percentage', 0.75], // Don't steal more than this in case something goes wrong with timing or scheduling, it's hard to recover from
    ['cycle-timing-delay', 16000], // Time
    ['queue-delay', 1000], // Delay before the first script begins, to give time for all scripts to be scheduled
    ['max-batches', 40], // Maximum overlapping cycles to schedule in advance. Note that once scheduled, we must wait for all batches to complete before we can schedule more
    ['i', false], // Farm intelligence with manual hack.
    ['reserved-ram', 64], // Keep this much home RAM free when scheduling hack/grow/weaken cycles on home.
    ['looping-mode', false], // Set to true to attempt to schedule perpetually-looping tasks.
    ['recovery-thread-padding', 1], // Multiply the number of grow/weaken threads needed by this amount to automatically recover more quickly from misfires.
    ['share', false], // Enable sharing free ram to increase faction rep gain (enabled automatically once RAM is sufficient)
    ['no-share', false], // Disable sharing free ram to increase faction rep gain
    ['share-cooldown', 5000], // Wait before attempting to schedule more share threads (e.g. to free RAM to be freed for hack batch scheduling first)
    ['share-max-utilization', 0.8], // Set to 1 if you don't care to leave any RAM free after sharing. Will use up to this much of the available RAM
    ['no-tail-windows', false], // Set to true to prevent the default behaviour of opening a tail window for certain launched scripts. (Doesn't affect scripts that open their own tail windows)
    ['initial-study-time', 10], // Seconds. Set to 0 to not do any studying at startup. By default, if early in an augmentation, will start with a little study to boost hack XP
    ['initial-hack-xp-time', 10], // Seconds. Set to 0 to not do any hack-xp grinding at startup. By default, if early in an augmentation, will start with a little study to boost hack XP
    ['disable-script', []], // The names of scripts that you do not want run by our scheduler
    ['run-script', []], // The names of additional scripts that you want daemon to run on home
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
// the number of milliseconds to delay the grow execution after theft to ensure it doesn't trigger too early and have no effect.
// For timing reasons the delay between each step should be *close* 1/4th of this number, but there is some imprecision
let cycleTimingDelay = 0; // (Set in command line args)
let queueDelay = 0; // (Set in command line args) The delay that it can take for a script to start, used to pessimistically schedule things in advance
let maxBatches = 0; // (Set in command line args) The max number of batches this daemon will spool up to avoid running out of IRL ram (TODO: Stop wasting RAM by scheduling batches so far in advance. e.g. Grind XP while waiting for cycle start!)
let maxTargets = 0; // (Set in command line args) Initial value, will grow if there is an abundance of RAM
let maxPreppingAtMaxTargets = 3; // The max servers we can prep when we're at our current max targets and have spare RAM
// Allows some home ram to be reserved for ad-hoc terminal script running and when home is explicitly set as the "preferred server" for starting a helper
let homeReservedRam = 0; // (Set in command line args)

let allHostNames = (/**@returns {string[]}*/() => [])(); // simple name array of servers that have been discovered
let _allServers = (/**@returns{Server[]}*/() => [])(); // Array of Server objects - our internal model of servers for hacking
// Lists of tools (external scripts) run
let hackTools, asynchronousHelpers, periodicScripts;
// toolkit var for remembering the names and costs of the scripts we use the most
let toolsByShortName = (/**@returns{{[id: string]: Tool;}}*/() => undefined)(); // Dictionary of tools keyed by tool short name
let allHelpersRunning = false; // Tracks whether all long-lived helper scripts have been launched
let studying = false; // Whether we're currently studying

// Command line Flags
let hackOnly = false; // "-h" command line arg - don't grow or shrink, just hack (a.k.a. scrapping mode)
let stockMode = false; // "-s" command line arg - hack/grow servers in a way that boosts our current stock positions
let stockFocus = false;  // If true, stocks are main source of income - kill any scripts that would do them harm
let xpOnly = false; // "-x" command line arg - focus on a strategy that produces the most hack EXP rather than money
let verbose = false; // "-v" command line arg - Detailed logs about batch scheduling / tuning
let runOnce = false; // "-o" command line arg - Good for debugging, run the main targettomg loop once then stop
let useHacknetNodes = false; // "-n" command line arg - Can toggle using hacknet nodes for extra hacking ram
let loopingMode = false;
let recoveryThreadPadding = 1; // How many multiples to increase the weaken/grow threads to recovery from misfires automatically (useful when RAM is abundant and timings are tight)

let hackHost = null; // the name of the host of this daemon, so we don't have to call the function more than once.
let hasFormulas = true;
let currentTerminalServer = ""; // Periodically updated when intelligence farming, the current connected terminal server.
let dictSourceFiles = (/**@returns{{[bitnode: number]: number;}}*/() => undefined)(); // Available source files
let bitnodeMults = null; // bitnode multipliers that can be automatically determined after SF-5
let playerBitnode = 0;
let haveTixApi = false, have4sApi = false; // Whether we have WSE API accesses
let _cachedPlayerInfo = (/**@returns{Player}*/() => undefined)(); // stores multipliers for player abilities and other player info
let _ns = (/**@returns{NS}*/() => undefined)(); // Globally available ns reference, for convenience

// Property to avoid log churn if our status hasn't changed since the last loop
let lastUpdate = "";
let lastUpdateTime = Date.now();
let lowUtilizationIterations = 0;
let highUtilizationIterations = 0;
let lastShareTime = 0; // Tracks when share was last invoked so we can respect the configured share-cooldown
let allTargetsPrepped = false;


//MAIN

// script entry point
/** @param {NS} ns **/
export async function main(ns) {
    daemonHost = "home"; // ns.getHostname(); // get the name of this node (realistically, will always be home)
    const runOptions = getConfiguration(ns, argsSchema);
    if (!runOptions) return;

    // Ensure no other copies of this script are running (they share memory)
    const scriptName = ns.getScriptName();
    const competingHacks = processList(ns, "home").filter(s => s.filename == scriptName && s.pid != ns.pid);
    if (competingDaemons.length > 0) { // We expect only 1, due to this logic, but just in case, generalize the code below to support multiple.
        const daemonPids = competingDaemons.map(p => p.pid);
        log(ns, `Info: Restarting another '${scriptName}' instance running on home (pid: ${daemonPids} args: ` +
            `[${competingDaemons[0].args.join(", ")}]) with new args ([${ns.args.join(", ")}])...`, true)
        const killPid = await killProcessIds(ns, daemonPids);
        await waitForProcessToComplete_Custom(ns, getHomeProcIsAlive(ns), killPid);
        await ns.sleep(loopInterval); // The game can be slow to kill scripts, give it an extra bit of time.
    }

    _ns = ns;
    disableLogs(ns, ['getServerMaxRam', 'getServerUsedRam', 'getServerMoneyAvailable', 'getServerGrowth', 'getServerSecurityLevel', 'exec', 'scan', 'sleep']);
    // Reset global vars on startup since they persist in memory in certain situations (such as on Augmentation)
    lastUpdate = "";
    lastUpdateTime = Date.now();
    maxTargets = 2;
    lowUtilizationIterations = highUtilizationIterations = 0;
    allHostNames = [], _allServers = [], psCache = [];

    const playerInfo = await getPlayerInfo(ns);

    // Process configuration
    options = runOptions;
    hackOnly = options.h || options['hack-only'];
    xpOnly = options.x || options['xp-only'];
    stockMode = (options.s || options['stock-manipulation'] || options['stock-manipulation-focus']) && !options['disable-stock-manipulation'];
    stockFocus = options['stock-manipulation-focus'] && !options['disable-stock-manipulation'];
    useHacknetNodes = options.n || options['use-hacknet-nodes'] || options['use-hacknet-servers'];
    verbose = options.v || options['verbose'];
    runOnce = options.o || options['run-once'];
    loopingMode = options['looping-mode'];
    recoveryThreadPadding = options['recovery-thread-padding'];

    // Log which flaggs are active
    if (hackOnly) log(ns, '-h - Hack-Only mode activated!');
    if (xpOnly) log(ns, '-x - Hack XP Grinding mode activated!');
    if (useHacknetNodes) log(ns, '-n - Using hacknet nodes to run scripts!');
    if (verbose) log(ns, '-v - Verbose logging activated!');
    if (runOnce) log(ns, '-o - Run-once mode activated!');
    if (stockMode) log(ns, 'Stock market manipulation mode is active (now enabled by default)');
    if (!stockMode) log(ns, "--disable-stock-manipulation - Stock manipulation has been disabled.");
    if (stockFocus) log(ns, '--stock-manipulation-focus - Stock market manipulation is the main priority');
    if (loopingMode) {
        log(ns, '--looping-mode - scheduled remote tasks will loop themselves');
        cycleTimingDelay = 0;
        queueDelay = 0;
        if (recoveryThreadPadding == 1) recoveryThreadPadding = 10;
        if (stockMode) stockFocus = true; // Need to actively kill scripts that go against stock because they will live forever
    }
    cycleTimingDelay = options['cycle-timing-delay'];
    queueDelay = options['queue-delay'];
    maxBatches = options['max-batches'];
    homeReservedRam = options['reserved-ram'];

    // These scripts are started once and expected to run forever (or terminate themselves when no longer needed)
    const openTailWindows = !options['no-tail-windows'];
    const reqRam = (ram) => ns.getServerMaxRam("home") >= ram; // To avoid wasting precious RAM, many scripts don't launch unless we have more than a certain amount

    hackTools = [
        { name: "/Remote/weak-target.js", shortName: "weak", threadSpreadingAllowed: true },
        { name: "/Remote/grow-target.js", shortName: "grow" },
        { name: "/Remote/hack-target.js", shortName: "hack" },
    ];
    hackTools.forEach(tool => tool.name = getFilePath(tool.name));

    await buildToolkit(ns, [...hackTools]); // build toolkit
    const allServers = await runCommand(ns, 'scanAllServers(ns)', '/Temp/scanAllServers.txt');
    await getStaticServerData(ns, allServers); // Gather information about servers that will never change
    await buildServerList(ns, false, allServers); // create the exhaustive server list
    await establishMultipliers(ns); // figure out the various bitnode and player multipliers
    maxTargets = options['initial-max-targets'];
}






// HELPERS
/** Ram-dodge getting updated player info. Note that this is the only async routine called in the main loop.
 * If latency or ram instability is an issue, you may wish to try uncommenting the direct request.
 * @param {NS} ns
 * @returns {Promise<Player>} */
async function getPlayerInfo(ns) {
    // return _cachedPlayerInfo = ns.getPlayer();
    return _cachedPlayerInfo = await getNsDataThroughFile(ns, `ns.getPlayer()`, '/Temp/player-info.txt');
}

function playerHackSkill() { return _cachedPlayerInfo.skills.hacking; }

function getPlayerHackingGrowMulti() { return _cachedPlayerInfo.mults.hacking_grow; };
