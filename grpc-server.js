import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { sequelize, User, Message } from "./db.js";
import { createRequire } from "module";

// Load CommonJS reflection module
const require = createRequire(import.meta.url);
const wrapServerWithReflection = require("grpc-node-server-reflection").default;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to proto file
const PROTO_PATH = path.join(__dirname, "chat.proto");

// Load proto definition
const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

// Load package and extract the chat package
const loadedProto = grpc.loadPackageDefinition(packageDefinition);
const chatProto = loadedProto.chat;

console.log("chatProto keys:", chatProto ? Object.keys(chatProto) : []);

export function startGrpcServer() {
  const server = new grpc.Server();

  // Defensive check
  const chatService = chatProto?.ChatService;
  console.log("chatService", chatService);

  if (!chatService) {
    throw new Error("chat.ChatService not found in loaded proto.");
  }

  server.addService(chatService.service, {
    async SendMessage(call, callback) {
      const { content, from, to, room, isPrivate } = call.request;
      try {
        const user = await User.findOne({ where: { nickname: from } });
        if (!user) return callback(new Error("Sender not found"));
        await Message.create({
          content,
          from,
          to,
          room,
          isPrivate,
          userId: user.id,
        });
        callback(null, {});
      } catch (err) {
        callback(err);
      }
    },

    async GetRooms(call, callback) {
      try {
        const rooms = await Message.findAll({
          attributes: [
            [sequelize.fn("DISTINCT", sequelize.col("room")), "room"],
          ],
          raw: true,
        });
        const roomNames = rooms.map((r) => r.room).filter(Boolean);
        callback(null, { nicknames: roomNames });
      } catch (err) {
        callback(err);
      }
    },

    async CreateUser(call, callback) {
      const { nickname } = call.request;
      try {
        await User.create({ nickname });
        callback(null, {});
      } catch (err) {
        if (err.name === "SequelizeUniqueConstraintError") {
          callback({
            code: grpc.status.ALREADY_EXISTS,
            message: "Nickname already exists",
          });
        } else {
          callback(err);
        }
      }
    },

    async GetUser(call, callback) {
      const { nickname } = call.request;
      const user = await User.findOne({ where: { nickname } });
      if (!user) return callback(new Error("User not found"));
      callback(null, { nickname: user.nickname });
    },

    async UpdateUser(call, callback) {
      const { oldNickname, newNickname } = call.request;
      const user = await User.findOne({ where: { nickname: oldNickname } });
      if (!user) return callback(new Error("User not found"));
      user.nickname = newNickname;
      await user.save();
      callback(null, {});
    },

    async DeleteUser(call, callback) {
      const { nickname } = call.request;
      await User.destroy({ where: { nickname } });
      callback(null, {});
    },

    async ListUsers(call, callback) {
      const users = await User.findAll();
      const nicknames = users.map((u) => u.nickname);
      callback(null, { nicknames });
    },

    async ListMessages(call, callback) {
      const messages = await Message.findAll({
        include: User,
        order: [["createdAt", "DESC"]],
      });
      callback(null, {
        messages: messages.map((msg) => ({
          id: msg.id,
          content: msg.content,
          from: msg.User.nickname,
          to: msg.to,
          room: msg.room,
          isPrivate: msg.isPrivate,
        })),
      });
    },

    async DeleteMessage(call, callback) {
      const { id } = call.request;
      await Message.destroy({ where: { id } });
      callback(null, {});
    },

    async ListMessagesByUser(call, callback) {
      const { nickname } = call.request;
      try {
        const messages = await Message.findAll({
          include: [{ model: User, where: { nickname } }],
          order: [["createdAt", "DESC"]],
        });
        callback(null, {
          messages: messages.map((msg) => ({
            id: msg.id,
            content: msg.content,
            from: msg.User.nickname,
            to: msg.to,
            room: msg.room,
            isPrivate: msg.isPrivate,
          })),
        });
      } catch (err) {
        callback(err);
      }
    },

    async UpdateMessage(call, callback) {
      const { id, content, to, room, isPrivate } = call.request;
      try {
        const message = await Message.findByPk(id);
        if (!message) {
          return callback({
            code: grpc.status.NOT_FOUND,
            message: "Message not found",
          });
        }
        if (content !== undefined) message.content = content;
        if (to !== undefined) message.to = to;
        if (room !== undefined) message.room = room;
        if (isPrivate !== undefined) message.isPrivate = isPrivate;
        await message.save();
        callback(null, {});
      } catch (err) {
        callback(err);
      }
    },
  });

  //  Enable reflection AFTER services are registered
  wrapServerWithReflection(server, {
    protoRoot: __dirname,
    protoFileNames: ["chat.proto"],
  });

  server.bindAsync(
    "0.0.0.0:50051",
    grpc.ServerCredentials.createInsecure(),
    () => {
      console.log("gRPC server running on port 50051");
    }
  );
}
