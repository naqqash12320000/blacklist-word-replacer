// todo : améliorer lettres tenus en compte dans le premier champ de !add "x" "y"
// implementer !remove
// implementer !help

import * as fs from "fs";
import { Client, Message, Permissions, TextChannel, User, Webhook } from "discord.js";
import { resolve } from "path";
import MapFile from "./MapFile";
import { config } from "dotenv";
import MessageReplacer from "./MessageReplacer";
import syncQueue from "./SyncQueue";
import Util from "./Util";

config({ path: resolve(__dirname, "../.env") });

const client = new Client();
let botID: string;
const prefix = "!";
let maps = new Map<string, MapFile>();
let webhookQueue = new syncQueue();

async function verifyMsg(msg: Message, map: MapFile): Promise<void> {
    let newMsg = MessageReplacer.transformMessage(msg.content, map);
    if (newMsg === null) return;
    // the message should be replaced
    if (!(msg.channel instanceof TextChannel)) throw "Error";
    let channel: TextChannel = msg.channel;
    let botMember = channel.members.get(botID);
    if (botMember === undefined) throw "Error";
    if (!Util.checkPermission("Remplacement du message précédent échoué", botMember, channel,
        [Permissions.FLAGS.MANAGE_WEBHOOKS, Permissions.FLAGS.MANAGE_MESSAGES])) {
        return;
    }
    if (!msg.deleted) msg.delete();
    webhookQueue.add(async () => {
        if (newMsg === null) throw "error";
        let wh: Webhook | undefined;
        let whError = "Échec de la création/récupération du webhook, veuillez contacter Mobyr !";
        let nickname = msg.member?.nickname;
        nickname = nickname == null ? msg.author.username : nickname;
        let avatar = msg.author.avatarURL();
        try {
            wh = (await channel.fetchWebhooks()).find(w => {
                if (!(w.owner instanceof User)) return false;
                return w.owner.id === botMember?.id;
            });
            if (wh == undefined) {
                wh = await channel.createWebhook(nickname, {
                    avatar: <string>avatar,
                });
            } else {
                await wh.edit({
                    avatar: <string>avatar,
                    name: nickname
                });
            }
        } catch (e) {
            channel.send(whError);
            return;
        }
        if (wh == undefined) {
            channel.send(whError);
            return;
        }
        await wh.send(newMsg.slice(0, 2000));
        if (newMsg.length > 2000) await wh.send(newMsg.slice(2000, 4000));
    });
}

function getContent(commands: string[], index: number) {
    return commands.slice(index).join(" ");
}

client.on("ready", () => {
    if (!fs.existsSync(resolve(__dirname, "../maps"))) fs.mkdirSync(resolve(__dirname, "../maps"));
    console.log(`Ready as ${client.user?.tag} in ${client.guilds.cache.size} servers !`);
    let id = client.user?.id;
    if (id == undefined) throw "Error";
    botID = id;
});

client.on("message", (msg) => {
    if (msg.author.bot) return;
    if (msg.channel.type !== "text" || msg.guild == undefined) return;
    let botMember = msg.channel.members.get(botID);
    if (botMember === undefined) throw "Error";
    if (!msg.channel.permissionsFor(botMember)?.has(Permissions.FLAGS.SEND_MESSAGES)) return;
    let map = maps.get(msg.guild.id);
    if (map === undefined) {
        map = new MapFile(resolve(__dirname, "../maps", msg.guild.id));
        maps.set(msg.guild.id, map);
    }
    if (!msg.content.startsWith(prefix) ||
        !msg.member?.hasPermission(Permissions.FLAGS.MANAGE_MESSAGES)) {
        verifyMsg(msg, map);
        return;
    }
    let commands = msg.content.slice(prefix.length).trim().split(/\s+/);
    if (commands[0] === "add") {
        let usage = "usage : " + prefix + "add \"search value\" \"replace value\"";
        const regex = /^"\s*([^\n]+)\s*"\s*"\s*([^\n]+)\s*"\s*$/;
        let content = getContent(commands, 1);
        let r = regex.exec(content)?.values();
        if (r === undefined) {
            msg.channel.send(usage);
            return;
        }
        r.next();
        map.set(
            MessageReplacer.normalizeKey(String(r.next().value)).value,
            String(r.next().value).trim()
        );
        msg.react("✅");
    } else if (commands[0] === "remove") {
        let usage = "usage : " + prefix + "add \"search value\"";
        const regex = /^"\s*([^\n]+)\s*"\s*$/;
        let content = getContent(commands, 1);
        let r = regex.exec(content)?.values();
        if (r === undefined) {
            msg.channel.send(usage);
            return;
        }
        r.next();
        let key = MessageReplacer.normalizeKey(String(r.next().value)).value;
        map.delete(key).then(b => {
            if (b) {
                msg.react("✅");
            } else {
                msg.channel.send("La valeur " + key + " n'a pas été trouvé. Veuillez faire " + prefix + "list pour voir les valeurs possibles.");
            }
        })
    } else if (commands[0] === "list" && commands.length === 1) {
        let x = 1;
        let content = "";
        let isEmpty = true;
        for (let key of map.keys()) {
            if (isEmpty) isEmpty = false;
            x++;
            content += "`" + key + "`" + " => " + "`" + map.get(key) + "`\n";
            if (x >= 15) {
                msg.channel.send(content);
                x = 1;
            }
        }
        if (x > 1) {
            msg.channel.send(content);
        } else if (isEmpty) {
            msg.channel.send("Aucune association enregistré.");
        }
    } else if (commands[0] === "help" && commands.length === 1) {
        msg.channel.send(
            prefix + "add \"search value\" \"replace value\"\n"
            + prefix + "remove \"search value\"\n"
            + prefix + "list\n"
        );
    } else {
        verifyMsg(msg, map);
    }
});

client.on("messageUpdate", async (oldMsg, msg) => {
    if (msg.partial) msg = await msg.fetch();
    if (msg.author.bot) return;
    if (msg.channel.type !== "text" || msg.guild == undefined) return;
    if (
        !msg.content.startsWith(prefix) ||
        !msg.member?.hasPermission(Permissions.FLAGS.MANAGE_MESSAGES)
    ) {
        let map = maps.get(msg.guild.id);
        if (map === undefined) {
            map = new MapFile(resolve(__dirname, "../maps", msg.guild.id));
            maps.set(msg.guild.id, map);
        }
        verifyMsg(msg, map);
        return;
    }
});

client.login(process.env.BOT_TOKEN);
