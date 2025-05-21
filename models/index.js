const { Sequelize } = require('sequelize');
require('dotenv').config();

const sequelize = new Sequelize(process.env.DB_NAME, process.env.DB_USER, process.env.DB_PASSWORD, {
  host: process.env.DB_HOST,
  dialect: 'postgres',
});

const User = require('./user.model')(sequelize);
const Settings = require('./settings.model')(sequelize);

const db = {
    sequelize,
    Sequelize,
    User,
    Settings
  };
  
  module.exports = db;