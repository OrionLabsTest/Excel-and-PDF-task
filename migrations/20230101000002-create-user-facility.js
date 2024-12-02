'use strict';

module.exports = {
    up: async (queryInterface, Sequelize) => {
        await queryInterface.createTable('UserFacilities', {
            id: {
                type: Sequelize.INTEGER,
                autoIncrement: true,
                primaryKey: true
            },
            UserId: {
                type: Sequelize.INTEGER,
                references: {
                    model: 'Users',
                    key: 'id'
                }
            },
            facility: {
                type: Sequelize.ENUM('Main Smartwash', 'Second Smartwash'),
                allowNull: false
            },
            createdAt: {
                allowNull: false,
                type: Sequelize.DATE
            },
            updatedAt: {
                allowNull: false,
                type: Sequelize.DATE
            }
        });

        // Example: Assign all existing users to both facilities
        const users = await queryInterface.sequelize.query('SELECT id FROM Users');
        const userIds = users[0].map(user => user.id);
        const userFacilityData = userIds.flatMap(userId => [
            { UserId: userId, facility: 'Main Smartwash', createdAt: new Date(), updatedAt: new Date() },
            { UserId: userId, facility: 'Second Smartwash', createdAt: new Date(), updatedAt: new Date() }
        ]);
        await queryInterface.bulkInsert('UserFacilities', userFacilityData);
    },

    down: async (queryInterface, Sequelize) => {
        await queryInterface.dropTable('UserFacilities');
    }
}; 