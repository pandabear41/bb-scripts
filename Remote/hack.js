import {MessageHandler, Payload} from "/Managers/MessageManager/class.js";
import {Action, ChannelName} from "/Managers/MessageManager/enum.js";
/** @param {NS} ns 
 * Wait until an appointed time and then execute a hack. */
export async function main(ns) {
    //args[0: target, 1: originID, 2: desired start time, 3: expected end, 4: expected duration, 5: description, 6: manipulate stock, 7: disable toast warnings, 8: loop count]
    const channelName = ChannelName.hackScript;
    const messageHandler = new MessageHandler(ns, channelName);
    const originId = ns.args.length > 1 ? ns.args[1] : 0;
    const sleepDuration = ns.args.length > 2 ? ns.args[2] - Date.now() : 0;
    const expectedDuration = ns.args.length > 4 ? ns.args[4] : 0;
    const manipulateStock = ns.args.length > 6 && ns.args[6] ? true : false;
    const disableToastWarnings = ns.args.length > 7 ? ns.args[7] : false;
    const loop = ns.args.length > 8 ? ns.args[8] : 0;
    let cycleTime = expectedDuration * 4;
    if (cycleTime < 100) cycleTime = Math.max(1, Math.min(5, cycleTime * 2)); // For fast hacking loops, inject a delay on hack in case grow/weaken are running a bit slow.
    if (sleepDuration > 0)
        await ns.sleep(sleepDuration);
    do {
        const results = await ns.hack(ns.args[0], { stock: manipulateStock })
        if (!results && !disableToastWarnings)
            ns.toast(`Warning, hack stole 0 money. Might be a misfire. ${JSON.stringify(ns.args)}`, 'warning');
        if (loop > 0) {
            await messageHandler.sendMessage(
                ChannelName.hackConductor,
                new Payload(Action.hackBatchDone, results),
                originId
            );
            await ns.sleep(cycleTime - expectedDuration);
        }
        loop--;
    } while (loop >= 0);
    await messageHandler.sendMessage(
        ChannelName.hackConductor,
        new Payload(Action.hackScriptDone, results),
        originId
    );
}