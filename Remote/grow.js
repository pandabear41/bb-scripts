import {MessageHandler, Payload} from "/Managers/MessageManager/class.js";
import {Action, ChannelName} from "/Managers/MessageManager/enum.js";
/**
 * @param {NS} ns 
 * Wait until an appointed time and then execute a grow. */
export async function main(ns) {
    //args[0: target, 1: originID, 2: desired start time, 3: expected end, 4: expected duration, 5: description, 6: manipulate stock, 7: loop count ]
    const channelName = ChannelName.hackScript;
    const messageHandler = new MessageHandler(ns, channelName);
    const originId = ns.args.length > 1 ? ns.args[1] : 0;
    const sleepDuration = ns.args.length > 2 ? ns.args[2] - Date.now() : 0;
    const expectedDuration = ns.args.length > 4 ? ns.args[4] : 0;
    const manipulateStock = ns.args.length > 6 && ns.args[6] ? true : false;
    const loop = ns.args.length > 7 ? ns.args[7] : 0;
    const cycleTime = expectedDuration / 3.2 * 4;
    if (sleepDuration > 0)
        await ns.sleep(sleepDuration);
    do {
        const results = await ns.grow(ns.args[0], { stock: manipulateStock });
        if (loop > 0) {
            await messageHandler.sendMessage(
                ChannelName.hackConductor,
                new Payload(Action.growBatchDone, results),
                originId
            );
            await ns.sleep(cycleTime - expectedDuration);
        }
        loop--;
    } while (loop >= 0);
    await messageHandler.sendMessage(
        ChannelName.hackConductor,
        new Payload(Action.growScriptDone, results),
        originId
    );

}