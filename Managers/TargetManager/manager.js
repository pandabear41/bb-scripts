import {Action, ChannelName} from "/Managers/MessageManager/enum.js";
import {Message, MessageActions, MessageHandler, Payload} from "/Managers/MessageManager/class.js";
import {
    HACKING_SCRIPTS, HACKING_SERVER, GENERAL_SLEEP,
    IMPORT_TO_COPY, MANAGING_SERVER, PORT_CRACKER, SCAN_SLEEP
} from "/Orchestrator/Config/Config";
import { disableLogs, getNsDataThroughFile } from "Lib/Helpers.js";
import { dprint } from "/Lib/Dprint.js";


const channelName = ChannelName.targetManager;
let currentHost = "";
let messageHandler = null;
let checkedHost = [];
let hackedHost = [];
let portOpener = [];
let allHostNames = [];

export async function main(ns) {
    disableLogs(ns, ['sleep', 'scp', 'scan'])
    currentHost = ns.getHostname();
    messageHandler = new MessageHandler(ns, channelName);

    checkedHost = [];
    hackedHost = [];
    portOpener = [];
    allHostNames = [];

    while (true) {
        dprint(ns, "Scanning network")
        portOpener = buildPortOpener();
        checkedHost = [];
        await scan_all(ns, currentHost);
        dprint(ns, "Finshing scan. Waiting for next cycle.");
        await ns.sleep(SCAN_SLEEP);
    }

}

async function scan_all(ns, base_host) {
    let hostArray = ns.scan(base_host);
    for (let i = 0; i < hostArray.length; i++) {
        const host = hostArray[i];
        if (!checkedHost.includes(host) && !host.includes("pserv-")) {
            checkedHost.push(host);
            if (checkHost(ns, host) && !hackedHost.includes(host)) {
                dprint(ns, "Found new host: " + host);
                // We ns.rm before since there seems to be a bug with cached import: https://github.com/danielyxie/bitburner/issues/2413
                if (host !== "home" && host !== HACKING_SERVER && host !== MANAGING_SERVER && !host.includes("pserv-")) {
                    await prepareServer(ns, host);
                }

                hackedHost.push(host);
                await broadcastNewHost(ns, host);
            }
            await ns.sleep(GENERAL_SLEEP);
            await scan_all(ns, host);
        }
    }
}

function checkHost(ns, host) {
    if (ns.getHackingLevel() >= ns.getServerRequiredHackingLevel(host) && !ns.hasRootAccess(host)) {
        const requiredPort = ns.getServerNumPortsRequired(host);
        if (requiredPort <= portOpener.length) {
            // We have enough port cracker
            let portOpen = 0;
            while (portOpen < requiredPort) {
                portOpener[portOpen](host);
                portOpen++;
            }
        } else {
            // Not enough port cracker
            return false;
        }
        // Can be hacked
        ns.nuke(host);
        return true;
    } else if (ns.getHackingLevel() >= ns.getServerRequiredHackingLevel(host) && ns.hasRootAccess(host)) {
        // Already root
        return true;
    } else {
        // Not enough hacking level
        return false;
    }
}

async function prepareServer(ns, host) {
    // Clear all scripts before sending new ones.
    for (let file of ns.ls(host, '.js'))
        ns.rm(file, host)
    await copyFile(ns, Object.values(HACKING_SCRIPTS), host);
    await copyFile(ns, IMPORT_TO_COPY, host);
}

async function broadcastNewHost(ns, host) {
    dprint(ns, "Broadcasting host: " + host);
    const payload = new Payload(Action.addHost, host);
    dprint(ns, "Broadcasting to Thread Manager");
    await messageHandler.sendMessage(ChannelName.threadManager, payload);
    dprint(ns, "Broadcasting to Hack Manager");
    await messageHandler.sendMessage(ChannelName.hackManager, payload);
}

function buildPortOpener(ns) {
    const opener = [];
    for (let i = 0; i < PORT_CRACKER(ns).length; i++) {
        if (ns.fileExists(PORT_CRACKER(ns)[i].file)) {
            opener.push(PORT_CRACKER(ns)[i].function);
        }
    }
    return opener;
}