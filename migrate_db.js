const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

// Source (local) database
const sourceDb = new Sequelize({
  dialect: 'postgres',
  host: process.env.SOURCE_DB_HOST,
  username: process.env.SOURCE_DB_USER,
  password: process.env.SOURCE_DB_PASSWORD,
  database: process.env.SOURCE_DB_NAME,
  logging: false,
 
  
});

// Target (remote) database
const targetDb = new Sequelize(process.env.TARGET_DB_URL, {
  dialect: 'postgres',
  logging: false,
 
});

async function migrateData() {
  try {
    // Test connections
    await sourceDb.authenticate();
    await targetDb.authenticate();
    console.log('Database connections established.');

    // Get all table information from source database
    const [tables] = await sourceDb.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
    `);

    for (const { table_name } of tables) {
      console.log(`\nMigrating table: ${table_name}`);

      // Get table schema
      const [columns] = await sourceDb.query(`
        SELECT column_name, data_type, column_default, is_nullable, 
               character_maximum_length, numeric_precision, numeric_scale
        FROM information_schema.columns
        WHERE table_name = '${table_name}'
        ORDER BY ordinal_position
      `);

      // Convert PostgreSQL types to Sequelize types
      const tableSchema = {};
      columns.forEach(column => {
        const type = mapPostgresType(column);
        tableSchema[column.column_name] = {
          type: type,
          allowNull: column.is_nullable === 'YES',
          defaultValue: column.column_default,
        };
      });

      // Define models for source and target
      const SourceModel = sourceDb.define(table_name, tableSchema, { 
        timestamps: false,
        freezeTableName: true 
      });
      const TargetModel = targetDb.define(table_name, tableSchema, { 
        timestamps: false,
        freezeTableName: true 
      });

      // Sync target table (create/update schema)
      await TargetModel.sync({ force: true });

      // Migrate data in chunks
      const chunkSize = 1000;
      let offset = 0;
      
      while (true) {
        const records = await SourceModel.findAll({
          limit: chunkSize,
          offset: offset,
          raw: true
        });

        if (records.length === 0) break;

        await TargetModel.bulkCreate(records);
        console.log(`Migrated ${offset + records.length} records from ${table_name}`);
        offset += chunkSize;
      }
    }

    console.log('\nMigration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    await sourceDb.close();
    await targetDb.close();
  }
}

function mapPostgresType(column) {
  const typeMap = {
    'character varying': DataTypes.STRING(column.character_maximum_length),
    'character': DataTypes.CHAR(column.character_maximum_length),
    'text': DataTypes.TEXT,
    'integer': DataTypes.INTEGER,
    'bigint': DataTypes.BIGINT,
    'smallint': DataTypes.SMALLINT,
    'decimal': DataTypes.DECIMAL(column.numeric_precision, column.numeric_scale),
    'numeric': DataTypes.DECIMAL(column.numeric_precision, column.numeric_scale),
    'real': DataTypes.FLOAT,
    'double precision': DataTypes.DOUBLE,
    'boolean': DataTypes.BOOLEAN,
    'date': DataTypes.DATE,
    'timestamp': DataTypes.DATE,
    'timestamp with time zone': DataTypes.DATE,
    'time': DataTypes.TIME,
    'json': DataTypes.JSON,
    'jsonb': DataTypes.JSONB,
  };

  return typeMap[column.data_type] || DataTypes.STRING;
}

migrateData(); 