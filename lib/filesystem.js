import { getNsDataThroughFile } from './process.js'

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
    if ((hostname === undefined || hostname === daemonHost) && !filename.endsWith('.exe'))
        return ns.read(filename) != '';
    return ns.fileExists(filename, hostname);
}

/** Helper to check which of a set of files exist on a remote server in a single batch ram-dodging request
 * @param {NS} ns
 * @param {string[]} filenames
 * @returns {Promise<boolean[]>} */
export async function filesExist(ns, filenames, hostname = undefined) {
    return await getNsDataThroughFile(ns, `ns.args.slice(1).map(f => ns.fileExists(f, ns.args[0]))`,
        '/Temp/files-exist.txt', [hostname ?? daemonHost, ...filenames])
}


/** A helper to parse the command line arguments with a bunch of extra features, such as
 * - Loading a persistent defaults override from a local config file named after the script.
 * - Rendering "--help" output without all scripts having to explicitly specify it
 * @param {NS} ns
 * @param {[string, string | number | boolean | string[]][]} argsSchema - Specification of possible command line args. **/
export function getConfiguration(ns, argsSchema) {
    checkNsInstance(ns, '"getConfig"');
    const scriptName = ns.getScriptName();
    // If the user has a local config file, override the defaults in the argsSchema
    const confName = `${scriptName}.config.txt`;
    const overrides = ns.read(confName);
    const overriddenSchema = overrides ? [...argsSchema] : argsSchema; // Clone the original args schema    
    if (overrides) {
        try {
            let parsedOverrides = JSON.parse(overrides); // Expect a parsable dict or array of 2-element arrays like args schema
            if (Array.isArray(parsedOverrides)) parsedOverrides = Object.fromEntries(parsedOverrides);
            log(ns, `INFO: Applying ${Object.keys(parsedOverrides).length} overriding default arguments from "${confName}"...`);
            for (const key in parsedOverrides) {
                const override = parsedOverrides[key];
                const matchIndex = overriddenSchema.findIndex(o => o[0] == key);
                const match = matchIndex === -1 ? null : overriddenSchema[matchIndex];
                if (!match)
                    throw new Error(`Unrecognized key "${key}" does not match of this script's options: ` + JSON.stringify(argsSchema.map(a => a[0])));
                else if (override === undefined)
                    throw new Error(`The key "${key}" appeared in the config with no value. Some value must be provided. Try null?`);
                else if (match && JSON.stringify(match[1]) != JSON.stringify(override)) {
                    if (typeof (match[1]) !== typeof (override))
                        log(ns, `WARNING: The "${confName}" overriding "${key}" value: ${JSON.stringify(override)} has a different type (${typeof override}) than the ` +
                            `current default value ${JSON.stringify(match[1])} (${typeof match[1]}). The resulting behaviour may be unpredictable.`, false, 'warning');
                    else
                        log(ns, `INFO: Overriding "${key}" value: ${JSON.stringify(match[1])}  ->  ${JSON.stringify(override)}`);
                    overriddenSchema[matchIndex] = { ...match }; // Clone the (previously shallow-copied) object at this position of the new argsSchema
                    overriddenSchema[matchIndex][1] = override; // Update the value of the clone.
                }
            }
        } catch (err) {
            log(ns, `ERROR: There's something wrong with your config file "${confName}", it cannot be loaded.` +
                `\nThe error encountered was: ${(typeof err === 'string' ? err : err.message || JSON.stringify(err))}` +
                `\nYour config file should either be a dictionary e.g.: { "string-opt": "value", "num-opt": 123, "array-opt": ["one", "two"] }` +
                `\nor an array of dict entries (2-element arrays) e.g.: [ ["string-opt", "value"], ["num-opt", 123], ["array-opt", ["one", "two"]] ]` +
                `\n"${confName}" contains:\n${overrides}`, true, 'error', 80);
            return null;
        }
    }
    // Return the result of using the in-game args parser to combine the defaults with the command line args provided
    try {
        const finalOptions = ns.flags(overriddenSchema);
        log(ns, `INFO: Running ${scriptName} with the following settings:` + Object.keys(finalOptions).filter(a => a != "_").map(a =>
            `\n  ${a.length == 1 ? "-" : "--"}${a} = ${finalOptions[a] === null ? "null" : JSON.stringify(finalOptions[a])}`).join("") +
            `\nrun ${scriptName} --help  to get more information about these options.`)
        return finalOptions;
    } catch (err) { // Detect if the user passed invalid arguments, and return help text
        const error = ns.args.includes("help") || ns.args.includes("--help") ? null : // Detect if the user explictly asked for help and suppress the error
            (typeof err === 'string' ? err : err.message || JSON.stringify(err));
        // Try to parse documentation about each argument from the source code's comments
        const source = ns.read(scriptName).split("\n");
        let argsRow = 1 + source.findIndex(row => row.includes("argsSchema ="));
        const optionDescriptions = {}
        while (argsRow && argsRow < source.length) {
            const nextArgRow = source[argsRow++].trim();
            if (nextArgRow.length == 0) continue;
            if (nextArgRow[0] == "]" || nextArgRow.includes(";")) break; // We've reached the end of the args schema
            const commentSplit = nextArgRow.split("//").map(e => e.trim());
            if (commentSplit.length != 2) continue; // This row doesn't appear to be in the format: [option...], // Comment
            const optionSplit = commentSplit[0].split("'"); // Expect something like: ['name', someDefault]. All we need is the name
            if (optionSplit.length < 2) continue;
            optionDescriptions[optionSplit[1]] = commentSplit[1];
        }
        log(ns, (error ? `ERROR: There was an error parsing the script arguments provided: ${error}\n` : 'INFO: ') +
            `${scriptName} possible arguments:` + argsSchema.map(a => `\n  ${a[0].length == 1 ? " -" : "--"}${a[0].padEnd(30)} ` +
                `Default: ${(a[1] === null ? "null" : JSON.stringify(a[1])).padEnd(10)}` +
                (a[0] in optionDescriptions ? ` // ${optionDescriptions[a[0]]}` : '')).join("") + '\n' +
            `\nTip: All argument names, and some values support auto-complete. Hit the <tab> key to autocomplete or see possible options.` +
            `\nTip: Array arguments are populated by specifying the argument multiple times, e.g.:` +
            `\n       run ${scriptName} --arrayArg first --arrayArg second --arrayArg third  to run the script with arrayArg=[first, second, third]` +
            (!overrides ? `\nTip: You can override the default values by creating a config file named "${confName}" containing e.g.: { "arg-name": "preferredValue" }`
                : overrides && !error ? `\nNote: The default values are being modified by overrides in your local "${confName}":\n${overrides}`
                    : `\nThis error may have been caused by your local overriding "${confName}" (especially if you changed the types of any options):\n${overrides}`), true);
        return null; // Caller should handle null and shut down elegantly.
    }
}