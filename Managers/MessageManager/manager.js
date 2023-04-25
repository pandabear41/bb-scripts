import { Message, NULL_PORT_DATA, Payload } from "/Managers/MessageManager/class.js";
import { Action, ChannelName } from "/Managers/MessageManager/enum.js";
import { dprint } from "/Lib/Dprint.js";
import { disableLogs } from "/Lib/helpers.js";
import { MESSAGE_LOOP_SLEEP } from "/Config/Config.js";

let messageQueue = [];
export async function main(ns) {
    disableLogs(ns, ['sleep']);
    emptyPorts(ns);
    let messageQueue = [];
    while (true) {
        await receiveMessage(ns);
        await checkMessageRequest(ns);
        await checkConsoleCall();
        await checkClearMessage();
        await ns.sleep(MESSAGE_LOOP_SLEEP);
    }
}

async function checkConsoleCall(ns) {
    const dumpQueue = extractMessage(m => m.payload.action === Action.dumpQueue);
    if (dumpQueue.length > 0) {
        for (const message of messageQueue) {
            ns.tprint("From: " + message.origin + ":" + message.originId + " -> To:" + message.destination + ":" + message.destinationId + " > Payload: " + JSON.stringify(message.payload));
        }
    }
}
async function checkClearMessage() {
    const messages = extractMessage(m => m.payload.action === Action.clearMyMessage);
    for (const message of messages) {
        messageQueue = messageQueue.filter(m => m.destinationId !== message.originId && m.destination !== message.origin);
    }
}
function extractMessage(filter) {
    const extractedMessage = messageQueue.filter(filter);
    messageQueue = messageQueue.filter(m => !filter(m));
    return extractedMessage;
}
async function checkMessageRequest(ns) {
    const requests = extractMessage(m => m.payload.action === Action.messageRequest);
    for (const request of requests) {
        const port = request.comPort;
        const requesterFilter = (m) => (m.destination === request.origin && m.destinationId === request.originId);
        let extraFilter = (m) => true;
        if (request.payload.info) {
            extraFilter = eval(request.payload.info);
        }
        const messageForRequester = extractMessage(requesterFilter);
        const messageToSend = messageForRequester.filter(extraFilter);
        const messageToKeep = messageForRequester.filter(m => !extraFilter(m));
        messageQueue.push(...messageToKeep);
        if (messageToSend.length > 0) {
            await dispatchMessage(ns, messageToSend, port);
        }
        await dispatchMessage(ns, [new Message(request.comPort, ChannelName.messageManager, request.origin, new Payload(Action.noMessage), null, request.originId)], port);
    }
}
async function dispatchMessage(ns, messageToSend, port) {
    for (const message of messageToSend) {
        message.dispatchedTime = Date.now();
        message.comPort = port;
        const writtenMessage = await ns.tryWritePort(message.comPort, message.string);
        if (!writtenMessage) {
            dprint(ns, "Sending failed: " + message.destination + ":" + message.destinationId + "(Port: " + message.comPort + "). Readded to queue.");
            messageQueue.push(message);
        }
    }
}
async function receiveMessage(ns) {
    for (let port = 1; port < 21; port++) {
        const response = ns.peek(port);
        if (response !== NULL_PORT_DATA) {
            let parsedResponse = Message.fromJSON(response);
            // If the message has been on top of the port queue for more than 1 second we push it at the back of the queue
            if (parsedResponse.dispatchedTime && (Date.now() - parsedResponse.dispatchedTime) > 1000) {
                if ((Date.now() - parsedResponse.dispatchedTime) > 1000) {
                    ns.readPort(port);
                    await dispatchMessage([parsedResponse], parsedResponse.comPort);
                    dprint(ns, "Stale to: " + parsedResponse.destination + ":" + parsedResponse.destinationId + " Action: " + parsedResponse.payload.action);
                }
                else if ((Date.now() - parsedResponse.dispatchedTime) > 60000) {
                    ns.readPort(port);
                    dprint(ns, "Discarded to: " + parsedResponse.destination + ":" + parsedResponse.destinationId + " Action: " + parsedResponse.payload.action);
                }
                // If the message has never been dispatched we read it
            }
            else if (!parsedResponse.dispatchedTime) {
                ns.readPort(port);
                messageQueue.push(parsedResponse);
            }
        }
    }
}
function emptyPorts(ns) {
    for (let i = 1; i < 21; i++) {
        while (true) {
            if (ns.readPort(i) === NULL_PORT_DATA) {
                break;
            }
        }
    }
}