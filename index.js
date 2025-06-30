import express from "express";
import http from "http";
import path from "path";
import { Server } from "socket.io";
import { sequelize, User, Message } from "./db.js";
import { startGrpcServer } from "./grpc-server.js";
import { rooms, nicknameToSocket, onlineUsers } from "./sharedState.js";

const app = express();
const server = http.createServer(app);
const io = new Server(server);

function getUsersInRoom(room) {
  const sockets = Array.from(io.sockets.adapter.rooms.get(room) || []);
  return sockets.map((id) => onlineUsers.get(id)).filter(Boolean);
}

io.use(async (socket, next) => {
  const { nickname } = socket.handshake.auth;
  if (!nickname) return next(new Error("Nickname is required"));

  let user = await User.findOne({ where: { nickname } });
  if (!user) user = await User.create({ nickname });

  socket.user = user;
  socket.nickname = nickname;
  next();
});

io.on("connection", async (socket) => {
  const { user, nickname } = socket;

  onlineUsers.set(socket.id, nickname);
  nicknameToSocket.set(nickname, socket.id);

  socket.emit("room-list", Array.from(rooms)); // send initial room list

  // User joins default room
  const defaultRoom = "general";
  socket.join(defaultRoom);
  socket.room = defaultRoom;

  io.to(defaultRoom).emit(
    "message",
    `${nickname} has joined the room: ${defaultRoom}`
  );
  io.to(defaultRoom).emit("online-users", getUsersInRoom(defaultRoom));

  // Send chat history of that room
  const history = await Message.findAll({
    where: { room: defaultRoom },
    include: User,
    order: [["createdAt", "DESC"]],
    // Remove or increase the limit
  });

  history.reverse().forEach((msg) => {
    if (
      msg.isPrivate &&
      (msg.to === nickname || msg.User.nickname === nickname)
    ) {
      socket.emit("message", `[PM] ${msg.User.nickname}: ${msg.content}`);
    } else if (!msg.isPrivate) {
      socket.emit("message", `${msg.User.nickname}: ${msg.content}`);
    }
  });

  // Switch room
  socket.on("join-room", async (newRoom) => {
    const oldRoom = socket.room;
    socket.leave(oldRoom);
    socket.join(newRoom);
    socket.room = newRoom;

    // Add new room to global list if not exists
    if (!rooms.has(newRoom)) {
      rooms.add(newRoom);
      io.emit("room-list", Array.from(rooms));
    }

    io.to(oldRoom).emit("message", `${nickname} has left the room.`);
    io.to(newRoom).emit("message", `${nickname} has joined the room.`);
    io.to(oldRoom).emit("online-users", getUsersInRoom(oldRoom));
    io.to(newRoom).emit("online-users", getUsersInRoom(newRoom));

    // Send chat history for new room
    const roomHistory = await Message.findAll({
      where: { room: newRoom },
      include: User,
      order: [["createdAt", "DESC"]],
      limit: 20,
    });

    socket.emit("clear-chat");
    roomHistory.reverse().forEach((msg) => {
      if (
        msg.isPrivate &&
        (msg.to === nickname || msg.User.nickname === nickname)
      ) {
        socket.emit("message", `[PM] ${msg.User.nickname}: ${msg.content}`);
      } else if (!msg.isPrivate) {
        socket.emit("message", `${msg.User.nickname}: ${msg.content}`);
      }
    });
  });

  // Public message
  socket.on("chat-message", async (msg) => {
    await Message.create({ content: msg, UserId: user.id, room: socket.room });
    socket.broadcast.to(socket.room).emit("message", `${nickname}: ${msg}`);
  });

  // Private message
  socket.on("private-message", async ({ to, message }) => {
    const targetSocketId = nicknameToSocket.get(to);
    await Message.create({
      content: message,
      UserId: user.id,
      to,
      isPrivate: true,
      room: socket.room,
    });
    if (targetSocketId) {
      io.to(targetSocketId).emit("private-message", {
        from: nickname,
        message,
      });
    }
  });

  // Typing
  socket.on("typing", () => {
    socket.to(socket.room).emit("typing", `${nickname} is typing...`);
  });

  socket.on("stop-typing", () => {
    socket.to(socket.room).emit("stop-typing");
  });

  socket.on("disconnect", () => {
    onlineUsers.delete(socket.id);
    nicknameToSocket.delete(nickname);
    io.to(socket.room).emit("message", `${nickname} has left the chat.`);
    io.to(socket.room).emit("online-users", getUsersInRoom(socket.room));
  });
});

app.use(express.static(path.resolve("public")));
app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "./public" });
});

server
  .listen(3000, () => {
    console.log("Server is running on port 3000");
  })
  .on("error", (err) => {
    console.error("Error starting server:", err);
  });

startGrpcServer();
