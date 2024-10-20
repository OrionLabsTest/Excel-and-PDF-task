'use strict';
/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('Operations', {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER
      },
      line: {
        type: Sequelize.STRING
      },
      tdate: {
        type: Sequelize.DATE
      },
      DESCR: {
        type: Sequelize.STRING
      },
      st: {
        type: Sequelize.DATE
      },
      nd: {
        type: Sequelize.DATE
      },
      tgap: {
        type: Sequelize.FLOAT
      },
      downtime: {
        type: Sequelize.FLOAT
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
  },
  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable('Operations');
  }
};