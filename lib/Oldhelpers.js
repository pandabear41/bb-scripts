

// // MISC
// const _cachedExports = {};
// /** @param {NS} ns - The nestcript instance passed to your script's main entry point
//  * @returns {string[]} The set of all funciton names exported by this file. */
// function getExports(ns) {
//     if (_cachedExports.length > 0) return _cachedExports;
//     const scriptHelpersRows = ns.read(getFilePath(file)).split("\n");
//     for (const row of scriptHelpersRows) {
//         if (!row.startsWith("export")) continue;
//         const funcNameStart = row.indexOf("function") + "function".length + 1;
//         const funcNameEnd = row.indexOf("(", funcNameStart);
//         _cachedExports.push(row.substring(funcNameStart, funcNameEnd));
//     }
//     return _cachedExports;
// }

