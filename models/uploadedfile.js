'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class UploadedFile extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
    }
  }
  UploadedFile.init({
    filename: DataTypes.STRING,
    originalname: DataTypes.STRING
  }, {
    sequelize,
    modelName: 'UploadedFile',
  });
  return UploadedFile;
};