const { DataTypes } = require('sequelize');
const sequelize = require('../db'); 

module.exports = (sequelize) => {
    const User = sequelize.define('user', {
    user_id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
    },
    first_name: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    last_name: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    username: {
        type: DataTypes.TEXT,
        unique: true,
        allowNull: false,
    },
    email: {
        type: DataTypes.TEXT,
        unique: true,
        allowNull: false,
    },
    password: {
        type: DataTypes.TEXT,
        allowNull: false,
    },
    refresh_token: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    verified: {
        type: DataTypes.BOOLEAN,
        defaultValue: false, // Default to false until email is verified
        allowNull: false,
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
    },
    updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
    },
}, {
    tableName: 'users', // Specify the table name
    timestamps: false // Disable automatic timestamps (createdAt, updatedAt)
});

return User;
};