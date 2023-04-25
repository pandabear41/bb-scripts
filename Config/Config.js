import {Action, ChannelName} from "/Managers/MessageManager/enum.js";
import {Message} from "/Managers/MessageManager/class.js";
import { HackMode, HackType, RequiredScript } from "/Managers/HackManager/enum.js";

export const MANAGING_SERVER = "home";
export const HACKING_SERVER = "home";
export const THREAD_SERVER = "home";


export const MESSAGE_LOOP_SLEEP = 10;
export const GENERAL_SLEEP = 100;
export const SCAN_SLEEP = 60000;


export const MIN_HACK_CHANCE = 0.5;
export const MIN_SERVER_FOR_UPDATE = 1;
export const MAX_SERVER_RAM = -1;
export const MONEY_HACKING_TARGET_PERCENT = 0.95;
export const USE_LOGISTIC_PROBABILITY = true;
export const TIMEOUT_THRESHOLD = 180 * 1000; // 3 minutes seems to be the sweet spot
export const USE_SHARE = true;
export const DEFAULT_HACKING_MODE = HackMode.money;
export const HACK_TYPE_PARTIAL_THREAD = [HackType.growWeakenHack];
export const SERVER_INITIAL_RAM = 8;
export const KILL_MESSAGE = m => m.payload.action === Action.kill;

// CONSTANTS
export const HACKING_CONDUCTOR = {
    [HackType.growWeakenHack]: "/Managers/HackManager/conductor/GrowWeakenConductor.js",
    [HackType.moneyHack]: "/Managers/HackManager/conductor/MoneyHackConductor.js",
    [HackType.xpHack]: "/Managers/HackManager/conductor/XpHackConductor.js",
};
export const HACK_MODE = {
    [HackMode.money]: [HackType.moneyHack, HackType.growWeakenHack],
    [HackMode.xp]: [HackType.xpHack]
};

export const HACKING_SCRIPTS = {
    [RequiredScript.hack]: "/Remote/hack.js",
    [RequiredScript.weaken]: "/Remote/weaken.js",
    [RequiredScript.grow]: "/Remote/grow.js",
    [RequiredScript.xp]: "/Remote/xp.js",
}

export const SHARING_SCRIPT = "/Managers/ThreadManager/script/share.js";
export const IMPORT_TO_COPY = [
    "/Managers/MessageManager/class.js",
    "/Managers/MessageManager/enum.js",
    "/Managers/Lib/Dprint.js",
    "/Managers/Config/Debug.js",
    "/Managers/HackManager/enum.js",
    SHARING_SCRIPT
];
export const PORT_CRACKER = (ns) => [
    { file: "BruteSSH.exe", function: ns.brutessh },
    { file: "FTPCrack.exe", function: ns.ftpcrack },
    { file: "relaySMTP.exe", function: ns.relaysmtp },
    { file: "HTTPWorm.exe", function: ns.httpworm },
    { file: "SQLInject.exe", function: ns.sqlinject },
];