import { Sequelize, DataTypes } from "sequelize";

const sequelize = new Sequelize(
  process.env.DB_NAME || "chatdb",
  process.env.DB_USER || "chatuser",
  process.env.DB_PASSWORD || "chatpass",
  {
    host: process.env.DB_HOST || "db",
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 5432,
    dialect: "postgres",
  }
);

const User = sequelize.define("User", {
  nickname: { type: DataTypes.STRING, unique: true, allowNull: false },
});

const Message = sequelize.define("Message", {
  content: { type: DataTypes.TEXT, allowNull: false },
  to: { type: DataTypes.STRING, allowNull: true }, // recipient nickname for private messages
  isPrivate: { type: DataTypes.BOOLEAN, defaultValue: false },
  room: { type: DataTypes.STRING }, //room support
});

User.hasMany(Message);
Message.belongsTo(User);

await sequelize.sync({ alter: true }); // sync all models

export { sequelize, User, Message };
