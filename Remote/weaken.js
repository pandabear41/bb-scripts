import {MessageHandler, Payload} from "/Managers/MessageManager/class.js";
import {Action, ChannelName} from "/Managers/MessageManager/enum.js";

/** @param {NS} ns 
 * Wait until an appointed time and then execute a weaken. */
export async function main(ns) {
    //args[0: target, 1: originID, 2: desired start time, 3: expected end, 4: expected duration, 5: description, 6: disable toast warnings, 7: loop]
    const channelName = ChannelName.hackScript;
    const messageHandler = new MessageHandler(ns, channelName);
    let sleepDuration = ns.args[2] - Date.now();
    const disableToastWarnings = ns.args.length > 6 ? ns.args[6] : false;
    const loop = ns.args.length > 7 ? ns.args[7] : 0;
    if (sleepDuration > 0)
        await ns.sleep(sleepDuration);
    do {
        if (!await ns.weaken(ns.args[0]) && !disableToastWarnings) {
            ns.toast(`Warning, weaken reduced 0 security. Might be a misfire. ${JSON.stringify(ns.args)}`, 'warning');
        }
        if (loop > 0) {
            await messageHandler.sendMessage(
                ChannelName.hackConductor,
                new Payload(Action.weakenBatchDone, results),
                originId
            );
        }
        loop--;
    } while (loop >= 0);
    await messageHandler.sendMessage(
        ChannelName.hackConductor,
        new Payload(Action.weakenScriptDone, results),
        originId
    );
}