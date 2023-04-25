import { MANAGING_SERVER } from '/Config/Config.js';
import { hashCode } from "/Lib/StringLib.js";


// == FILE  ===
/** Joins all arguments as components in a path, e.g. pathJoin("foo", "bar", "/baz") = "foo/bar/baz" **/
export function pathJoin(...args) {
    return args.filter(s => !!s).join('/').replace(/\/\/+/g, '/');
}

/** Gets the path for the given local file, taking into account optional subfolder relocation via git-pull.js **/
export function getFilePath(file) {
    const subfolder = '';  // git-pull.js optionally modifies this when downloading
    return pathJoin(subfolder, file);
}

/** Helper to check if a file exists.
 * A helper is used so that we have the option of exploring alternative implementations that cost less/no RAM.
 * @param {NS} ns */
export function doesFileExist(ns, filename, hostname = undefined) {
    // Fast (and free) - for local files, try to read the file and ensure it's not empty
    if ((hostname === undefined || hostname === MANAGING_SERVER) && !filename.endsWith('.exe'))
        return ns.read(filename) != '';
    return ns.fileExists(filename, hostname);
}

/** Helper to check which of a set of files exist on a remote server in a single batch ram-dodging request
 * @param {NS} ns
 * @param {string[]} filenames
 * @returns {Promise<boolean[]>} */
export async function filesExist(ns, filenames, hostname = undefined) {
    return await getNsDataThroughFile(ns, `ns.args.slice(1).map(f => ns.fileExists(f, ns.args[0]))`,
        '/Temp/files-exist.txt', [hostname ?? MANAGING_SERVER, ...filenames])
}

export async function copyFile(ns, fileList, host) {
    for (let j = 0; j < fileList.length; j++) {
        const script = fileList[j]
        ns.fileExists(script, host) && ns.rm(script, host)
        await ns.scp(script, "home", host);
    }
}


// === Processes ===

/** @param {NS} ns 
 * Returns a helpful error message if we forgot to pass the ns instance to a function */
export function checkNsInstance(ns, fnName = "this function") {
    if (ns === undefined || !ns.print) throw new Error(`The first argument to ${fnName} should be a 'ns' instance.`);
    return ns;
}


/** @param {NS} ns
 *  Use where a function is required to run a script and you have already referenced ns.run in your script **/
export function getFnRunViaNsRun(ns) { return checkNsInstance(ns, '"getFnRunViaNsRun"').run; }


/** @param {NS} ns
 *  Use where a function is required to run a script and you have already referenced ns.exec in your script **/
export function getFnRunViaNsExec(ns, host = "home") {
    checkNsInstance(ns, '"getFnRunViaNsExec"');
    return function (scriptPath, ...args) { return ns.exec(scriptPath, host, ...args); }
}

// VARIATIONS ON NS.ISRUNNING

/** @param {NS} ns
 *  Use where a function is required to run a script and you have already referenced ns.run in your script  */
export function getFnIsAliveViaNsIsRunning(ns) { return checkNsInstance(ns, '"getFnIsAliveViaNsIsRunning"').isRunning; }

/** @param {NS} ns
 *  Use where a function is required to run a script and you have already referenced ns.ps in your script  */
export function getFnIsAliveViaNsPs(ns) {
    checkNsInstance(ns, '"getFnIsAliveViaNsPs"');
    return function (pid, host) { return ns.ps(host).some(process => process.pid === pid); }
}

/**
 * Retrieve the result of an ns command by executing it in a temporary .js script, writing the result to a file, then shuting it down
 * Importing incurs a maximum of 1.1 GB RAM (0 GB for ns.read, 1 GB for ns.run, 0.1 GB for ns.isRunning).
 * Has the capacity to retry if there is a failure (e.g. due to lack of RAM available). Not recommended for performance-critical code.
 * @param {NS} ns - The nestcript instance passed to your script's main entry point
 * @param {string} command - The ns command that should be invoked to get the desired data (e.g. "ns.getServer('home')" )
 * @param {string=} fName - (default "/Temp/{commandhash}-data.txt") The name of the file to which data will be written to disk by a temporary process
 * @param {args=} args - args to be passed in as arguments to command being run as a new script.
 * @param {bool=} verbose - (default false) If set to true, pid and result of command are logged.
 **/
export async function getNsDataThroughFile(ns, command, fName, args = [], verbose = false, maxRetries = 5, retryDelayMs = 50) {
    checkNsInstance(ns, '"getNsDataThroughFile"');
    if (!verbose) disableLogs(ns, ['run', 'isRunning']);
    return await getNsDataThroughFile_Custom(ns, ns.run, command, fName, args, verbose, maxRetries, retryDelayMs);
}

/**
 * An advanced version of getNsDataThroughFile that lets you pass your own "fnRun" implementation to reduce RAM requirements
 * Importing incurs no RAM (now that ns.read is free) plus whatever fnRun you provide it
 * Has the capacity to retry if there is a failure (e.g. due to lack of RAM available). Not recommended for performance-critical code.
 * @param {NS} ns - The nestcript instance passed to your script's main entry point
 * @param {function} fnRun - A single-argument function used to start the new sript, e.g. `ns.run` or `(f,...args) => ns.exec(f, "home", ...args)`
 * @param {args=} args - args to be passed in as arguments to command being run as a new script.
 **/
export async function getNsDataThroughFile_Custom(ns, fnRun, command, fName, args = [], verbose = false, maxRetries = 5, retryDelayMs = 50) {
    checkNsInstance(ns, '"getNsDataThroughFile_Custom"');
    if (!verbose) disableLogs(ns, ['read']);
    const commandHash = hashCode(command);
    fName = fName || `/Temp/${commandHash}-data.txt`;
    const fNameCommand = (fName || `/Temp/${commandHash}-command`) + '.js'
    // Pre-write contents to the file that will allow us to detect if our temp script never got run
    const initialContents = "<Insufficient RAM>";
    ns.write(fName, initialContents, 'w');
    // Prepare a command that will write out a new file containing the results of the command
    // unless it already exists with the same contents (saves time/ram to check first)
    // If an error occurs, it will write an empty file to avoid old results being misread.
    const commandToFile = `let r;try{r=JSON.stringify(\n` +
        `    ${command}\n` +
        `);}catch(e){r="ERROR: "+(typeof e=='string'?e:e.message||JSON.stringify(e));}\n` +
        `const f="${fName}"; if(ns.read(f)!==r) ns.write(f,r,'w')`;
    // Run the command with auto-retries if it fails
    const pid = await runCommand_Custom(ns, fnRun, commandToFile, fNameCommand, args, verbose, maxRetries, retryDelayMs);
    // Wait for the process to complete. Note, as long as the above returned a pid, we don't actually have to check it, just the file contents
    const fnIsAlive = (ignored_pid) => ns.read(fName) === initialContents;
    await waitForProcessToComplete_Custom(ns, fnIsAlive, pid, verbose);
    if (verbose) log(ns, `Process ${pid} is done. Reading the contents of ${fName}...`);
    // Read the file, with auto-retries if it fails // TODO: Unsure reading a file can fail or needs retrying. 
    let lastRead;
    const fileData = await autoRetry(ns, () => ns.read(fName),
        f => (lastRead = f) !== undefined && f !== "" && f !== initialContents && !(typeof f == "string" && f.startsWith("ERROR: ")),
        () => `\nns.read('${fName}') returned a bad result: "${lastRead}".` +
            `\n  Script:  ${fNameCommand}\n  Args:    ${JSON.stringify(args)}\n  Command: ${command}` +
            (lastRead == undefined ? '\nThe developer has no idea how this could have happened. Please post a screenshot of this error on discord.' :
                lastRead == initialContents ? `\nThe script that ran this will likely recover and try again later once you have more free ram.` :
                    lastRead == "" ? `\nThe file appears to have been deleted before a result could be retrieved. Perhaps there is a conflicting script.` :
                        `\nThe script was likely passed invalid arguments.`),
        maxRetries, retryDelayMs, undefined, verbose, verbose);
    if (verbose) log(ns, `Read the following data for command ${command}:\n${fileData}`);
    return JSON.parse(fileData); // Deserialize it back into an object/array and return
}

/** Evaluate an arbitrary ns command by writing it to a new script and then running or executing it.
 * @param {NS} ns - The nestcript instance passed to your script's main entry point
 * @param {string} command - The ns command that should be invoked to get the desired data (e.g. "ns.getServer('home')" )
 * @param {string=} fileName - (default "/Temp/{commandhash}-data.txt") The name of the file to which data will be written to disk by a temporary process
 * @param {args=} args - args to be passed in as arguments to command being run as a new script.
 * @param {bool=} verbose - (default false) If set to true, the evaluation result of the command is printed to the terminal
 */
export async function runCommand(ns, command, fileName, args = [], verbose = false, maxRetries = 5, retryDelayMs = 50) {
    checkNsInstance(ns, '"runCommand"');
    if (!verbose) disableLogs(ns, ['run']);
    return await runCommand_Custom(ns, ns.run, command, fileName, args, verbose, maxRetries, retryDelayMs);
}


/**
 * An advanced version of runCommand that lets you pass your own "isAlive" test to reduce RAM requirements (e.g. to avoid referencing ns.isRunning)
 * Importing incurs 0 GB RAM (assuming fnRun, fnWrite are implemented using another ns function you already reference elsewhere like ns.exec)
 * @param {NS} ns - The nestcript instance passed to your script's main entry point
 * @param {function} fnRun - A single-argument function used to start the new sript, e.g. `ns.run` or `(f,...args) => ns.exec(f, "home", ...args)`
 * @param {string} command - The ns command that should be invoked to get the desired data (e.g. "ns.getServer('home')" )
 * @param {string=} fileName - (default "/Temp/{commandhash}-data.txt") The name of the file to which data will be written to disk by a temporary process
 * @param {args=} args - args to be passed in as arguments to command being run as a new script.
 **/
export async function runCommand_Custom(ns, fnRun, command, fileName, args = [], verbose = false, maxRetries = 5, retryDelayMs = 50) {
    checkNsInstance(ns, '"runCommand_Custom"');
    if (!Array.isArray(args)) throw new Error(`args specified were a ${typeof args}, but an array is required.`);
    if (!verbose) disableLogs(ns, ['sleep']);
    // Auto-import any helpers that the temp script attempts to use
    const required = getExports(ns).filter(e => command.includes(`${e}(`));
    let script = (required.length > 0 ? `import { ${required.join(", ")} } from '/Lib/Helpers.js'\n` : '') +
        `export async function main(ns) { ${command} }`;
    fileName = fileName || `/Temp/${hashCode(command)}-command.js`;
    if (verbose)
        log(ns, `INFO: Using a temporary script (${fileName}) to execute the command:` +
            `\n  ${command}\nWith the following arguments:    ${JSON.stringify(args)}`);
    // It's possible for the file to be deleted while we're trying to execute it, so even wrap writing the file in a retry
    return await autoRetry(ns, async () => {
        // To improve performance, don't re-write the temp script if it's already in place with the correct contents.
        const oldContents = ns.read(fileName);
        if (oldContents != script) {
            if (oldContents) // Create some noise if temp scripts are being created with the same name but different contents
                ns.tprint(`WARNING: Had to overwrite temp script ${fileName}\nOld Contents:\n${oldContents}\nNew Contents:\n${script}` +
                    `\nThis warning is generated as part of an effort to switch over to using only 'immutable' temp scripts. `);
            ns.write(fileName, script, "w");
            // Wait for the script to appear and be readable (game can be finicky on actually completing the write)
            await autoRetry(ns, () => ns.read(fileName), c => c == script, () => `Temporary script ${fileName} is not available, ` +
                `despite having written it. (Did a competing process delete or overwrite it?)`, maxRetries, retryDelayMs, undefined, verbose, verbose);
        }
        // Run the script, now that we're sure it is in place
        return fnRun(fileName, 1 /* Always 1 thread */, ...args);
    }, pid => pid !== 0,
        () => `The temp script was not run (likely due to insufficient RAM).` +
            `\n  Script:  ${fileName}\n  Args:    ${JSON.stringify(args)}\n  Command: ${command}` +
            `\nThe script that ran this will likely recover and try again later once you have more free ram.`,
        maxRetries, retryDelayMs, undefined, verbose, verbose);
}

/**
 * Wait for a process id to complete running
 * Importing incurs a maximum of 0.1 GB RAM (for ns.isRunning) 
 * @param {NS} ns - The nestcript instance passed to your script's main entry point
 * @param {int} pid - The process id to monitor
 * @param {bool=} verbose - (default false) If set to true, pid and result of command are logged.
 **/
export async function waitForProcessToComplete(ns, pid, verbose) {
    checkNsInstance(ns, '"waitForProcessToComplete"');
    if (!verbose) disableLogs(ns, ['isRunning']);
    return await waitForProcessToComplete_Custom(ns, ns.isRunning, pid, verbose);
}
/**
 * An advanced version of waitForProcessToComplete that lets you pass your own "isAlive" test to reduce RAM requirements (e.g. to avoid referencing ns.isRunning)
 * Importing incurs 0 GB RAM (assuming fnIsAlive is implemented using another ns function you already reference elsewhere like ns.ps) 
 * @param {NS} ns - The nestcript instance passed to your script's main entry point
 * @param {(pid: number) => Promise<boolean>} fnIsAlive - A single-argument function used to start the new sript, e.g. `ns.isRunning` or `pid => ns.ps("home").some(process => process.pid === pid)`
 **/
export async function waitForProcessToComplete_Custom(ns, fnIsAlive, pid, verbose) {
    checkNsInstance(ns, '"waitForProcessToComplete_Custom"');
    if (!verbose) disableLogs(ns, ['sleep']);
    // Wait for the PID to stop running (cheaper than e.g. deleting (rm) a possibly pre-existing file and waiting for it to be recreated)
    let start = Date.now();
    let sleepMs = 1;
    let done = false;
    for (var retries = 0; retries < 1000; retries++) {
        if (!(await fnIsAlive(pid))) {
            done = true;
            break; // Script is done running
        }
        if (verbose && retries % 100 === 0) ns.print(`Waiting for pid ${pid} to complete... (${formatDuration(Date.now() - start)})`);
        await ns.sleep(sleepMs);
        sleepMs = Math.min(sleepMs * 2, 200);
    }
    // Make sure that the process has shut down and we haven't just stopped retrying
    if (!done) {
        let errorMessage = `run-command pid ${pid} is running much longer than expected. Max retries exceeded.`;
        ns.print(errorMessage);
        throw new Error(errorMessage);
    }
}


/** Helper to retry something that failed temporarily (can happen when e.g. we temporarily don't have enough RAM to run)
 * @param {NS} ns - The nestcript instance passed to your script's main entry point */
export async function autoRetry(ns, fnFunctionThatMayFail, fnSuccessCondition, errorContext = "Success condition not met",
    maxRetries = 5, initialRetryDelayMs = 50, backoffRate = 3, verbose = false, tprintFatalErrors = true) {
    checkNsInstance(ns, '"autoRetry"');
    let retryDelayMs = initialRetryDelayMs, attempts = 0;
    while (attempts++ <= maxRetries) {
        try {
            const result = await fnFunctionThatMayFail()
            const error = typeof errorContext === 'string' ? errorContext : errorContext();
            if (!fnSuccessCondition(result))
                throw asError(error);
            return result;
        }
        catch (error) {
            const fatal = attempts >= maxRetries;
            log(ns, `${fatal ? 'FAIL' : 'INFO'}: Attempt ${attempts} of ${maxRetries} failed` +
                (fatal ? `: ${typeof error === 'string' ? error : error.message || JSON.stringify(error)}` : `. Trying again in ${retryDelayMs}ms...`),
                tprintFatalErrors && fatal, !verbose ? undefined : (fatal ? 'error' : 'info'))
            if (fatal) throw asError(error);
            await ns.sleep(retryDelayMs);
            retryDelayMs *= backoffRate;
        }
    }
}

/** @param {NS} ns 
 * Returns the number of instances of the current script running on the specified host. **/
export async function instanceCount(ns, onHost = "home", warn = true, tailOtherInstances = true) {
    checkNsInstance(ns, '"alreadyRunning"');
    const scriptName = ns.getScriptName();
    const others = await getNsDataThroughFile(ns, 'ns.ps(ns.args[0]).filter(p => p.filename == ns.args[1]).map(p => p.pid)',
        '/Temp/ps-other-instances.txt', [onHost, scriptName]);
    if (others.length >= 2) {
        if (warn)
            log(ns, `WARNING: You cannot start multiple versions of this script (${scriptName}). Please shut down the other instance first.` +
                (tailOtherInstances ? ' (To help with this, a tail window for the other instance will be opened)' : ''), true, 'warning');
        if (tailOtherInstances) // Tail all but the last pid, since it will belong to the current instance (which will be shut down)
            others.slice(0, others.length - 1).forEach(pid => ns.tail(pid));
    }
    return others.length;
}


const _cachedExports = [];
/** @param {NS} ns - The nestcript instance passed to your script's main entry point
 * @returns {string[]} The set of all funciton names exported by this file. */
function getExports(ns) {
    if (_cachedExports.length > 0) return _cachedExports;
    const scriptHelpersRows = ns.read(getFilePath('/Lib/Helpers.js')).split("\n");
    for (const row of scriptHelpersRows) {
        if (!row.startsWith("export")) continue;
        const funcNameStart = row.indexOf("function") + "function".length + 1;
        const funcNameEnd = row.indexOf("(", funcNameStart);
        _cachedExports.push(row.substring(funcNameStart, funcNameEnd));
    }
    return _cachedExports;
}

// === Logs ===
/** @param {NS} ns **/
export function disableLogs(ns, listOfLogs) { ['disableLog'].concat(...listOfLogs).forEach(log => checkNsInstance(ns, '"disableLogs"').disableLog(log)); }

/** Helper to log a message, and optionally also tprint it and toast it
 * @param {NS} ns - The nestcript instance passed to your script's main entry point */
export function log(ns, message = "", alsoPrintToTerminal = false, toastStyle = "", maxToastLength = Number.MAX_SAFE_INTEGER) {
    checkNsInstance(ns, '"log"');
    ns.print(message);
    if (toastStyle) ns.toast(message.length <= maxToastLength ? message : message.substring(0, maxToastLength - 3) + "...", toastStyle);
    if (alsoPrintToTerminal) {
        ns.tprint(message);
        // TODO: Find a way write things logged to the terminal to a "permanent" terminal log file, preferably without this becoming an async function.
        //       Perhaps we copy logs to a port so that a separate script can optionally pop and append them to a file.
        //ns.write("log.terminal.txt", message + '\n', 'a'); // Note: we should get away with not awaiting this promise since it's not a script file
    }
    return message;
}

/** If the argument is an Error instance, returns it as is, otherwise, returns a new Error instance. */
export function asError(error) {
    return error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error));
}

/** Helper to get a list of all hostnames on the network
 * @param {NS} ns - The nestcript instance passed to your script's main entry point */
export function scanAllServers(ns) {
    checkNsInstance(ns, '"scanAllServers"');
    let discoveredHosts = []; // Hosts (a.k.a. servers) we have scanned
    let hostsToScan = ["home"]; // Hosts we know about, but have no yet scanned
    let infiniteLoopProtection = 9999; // In case you mess with this code, this should save you from getting stuck
    while (hostsToScan.length > 0 && infiniteLoopProtection-- > 0) { // Loop until the list of hosts to scan is empty
        let hostName = hostsToScan.pop(); // Get the next host to be scanned
        discoveredHosts.push(hostName); // Mark this host as "scanned"
        for (const connectedHost of ns.scan(hostName)) // "scan" (list all hosts connected to this one)
            if (!discoveredHosts.includes(connectedHost) && !hostsToScan.includes(connectedHost)) // If we haven't found this host
                hostsToScan.push(connectedHost); // Add it to the queue of hosts to be scanned
    }
    return discoveredHosts; // The list of scanned hosts should now be the set of all hosts in the game!
}
