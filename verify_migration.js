const { Sequelize } = require('sequelize');
require('dotenv').config();

const sourceDb = new Sequelize({
  dialect: 'postgres',
  host: process.env.SOURCE_DB_HOST,
  username: process.env.SOURCE_DB_USER,
  password: process.env.SOURCE_DB_PASSWORD,
  database: process.env.SOURCE_DB_NAME,
  logging: false
});

const targetDb = new Sequelize(process.env.TARGET_DB_URL, {
  dialect: 'postgres',
  logging: false
});

async function verifyMigration() {
  try {
    // Get all tables
    const [tables] = await sourceDb.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    `);

    for (const { table_name } of tables) {
      // Get record counts
      const [[sourceCount], [targetCount]] = await Promise.all([
        sourceDb.query(`SELECT COUNT(*) as count FROM "${table_name}"`),
        targetDb.query(`SELECT COUNT(*) as count FROM "${table_name}"`)
      ]);

      console.log(`\nTable: ${table_name}`);
      console.log(`Source records: ${sourceCount.count}`);
      console.log(`Target records: ${targetCount.count}`);
      console.log(`Match: ${sourceCount.count === targetCount.count}`);

      // Verify data samples
      const [[sourceSample], [targetSample]] = await Promise.all([
        sourceDb.query(`SELECT * FROM "${table_name}" LIMIT 1`),
        targetDb.query(`SELECT * FROM "${table_name}" LIMIT 1`)
      ]);

      if (sourceSample.length && targetSample.length) {
        const columnsMatch = Object.keys(sourceSample[0]).every(
          key => key in targetSample[0]
        );
        console.log(`Schema match: ${columnsMatch}`);
      }
    }
  } catch (error) {
    console.error('Verification failed:', error);
  } finally {
    await sourceDb.close();
    await targetDb.close();
  }
}

verifyMigration(); 