const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const UserSettings = sequelize.define('user_settings', {
    user_id: {
        type: DataTypes.UUID,
        primaryKey: true,
        references: {
            model: 'users', // Table name for the users model
            key: 'user_id',
        },
        onDelete: 'CASCADE', // Ensures cascading delete
    },
    theme: {
        type: DataTypes.TEXT,
        defaultValue: 'dark',
    },
    telemetry_units: {
        type: DataTypes.TEXT,
        defaultValue: 'metric',
    },
    favorite_driver: {
        type: DataTypes.TEXT,
        allowNull: true,
    },
    notifications_enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
    },
}, {
    tableName: 'users', // Specify the table name
    timestamps: false // Disable automatic timestamps (createdAt, updatedAt)
});

return UserSettings;
};