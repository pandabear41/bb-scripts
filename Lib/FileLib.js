import { getNsDataThroughFile } from '/Lib/ProcessLib.js'
import { MAIN_SERVER } from '/Config/Config.js';

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
    if ((hostname === undefined || hostname === MAIN_SERVER) && !filename.endsWith('.exe'))
        return ns.read(filename) != '';
    return ns.fileExists(filename, hostname);
}

/** Helper to check which of a set of files exist on a remote server in a single batch ram-dodging request
 * @param {NS} ns
 * @param {string[]} filenames
 * @returns {Promise<boolean[]>} */
export async function filesExist(ns, filenames, hostname = undefined) {
    return await getNsDataThroughFile(ns, `ns.args.slice(1).map(f => ns.fileExists(f, ns.args[0]))`,
        '/Temp/files-exist.txt', [hostname ?? MAIN_SERVER, ...filenames])
}

export async function copyFile(ns, fileList, host) {
    for (let j = 0; j < fileList.length; j++) {
        const script = fileList[j]
        ns.fileExists(script, host) && ns.rm(script, host)
        await ns.scp(script, "home", host);
    }
}