import { DEBUG } from "/Config/Debug";

export function dprint(ns, string) {
    if (DEBUG) {
        const now = new Date(Date.now())
        const hour = now.getHours()
        const minute = now.getMinutes()
        const second = now.getSeconds()
        const timestamp = hour + ":" + minute + ":" + second
        ns.print(timestamp + ": " + message)
    }
}