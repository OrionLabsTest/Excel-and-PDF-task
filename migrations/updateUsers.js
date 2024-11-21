const { Sequelize } = require('sequelize');
require('dotenv').config();

async function updateExistingRecords() {
  const sequelize = new Sequelize(process.env.DATABASE_URL, {
    dialect: 'postgres',
    dialectOptions: {
      ssl: {
        require: true,
        rejectUnauthorized: false
      }
    }
  });

  try {
    // First, add the facility column to Users if it doesn't exist
    await sequelize.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                      WHERE table_name = 'Users' AND column_name = 'facility') THEN
          ALTER TABLE "Users" 
          ADD COLUMN facility VARCHAR(255) DEFAULT 'Main Smartwash';
        END IF;
      END $$;
    `);

    // Add ENUM type for uploadType if it doesn't exist
    await sequelize.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_Operations_uploadType') THEN
          CREATE TYPE "enum_Operations_uploadType" AS ENUM ('Control deduction', 'Sensor deduction');
        END IF;
      END $$;
    `);

    // Add uploadType column to Operations if it doesn't exist
    await sequelize.query(`
      DO $$ 
      BEGIN 
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                      WHERE table_name = 'Operations' AND column_name = 'uploadType') THEN
          ALTER TABLE "Operations" 
          ADD COLUMN "uploadType" "enum_Operations_uploadType" DEFAULT 'Control deduction';
        END IF;
      END $$;
    `);

    // Update existing users with default facility
    await sequelize.query(`
      UPDATE "Users"
      SET facility = 'Main Smartwash'
      WHERE facility IS NULL;
    `);
    console.log('Successfully updated existing users with default facility');

    // Update existing operations with default upload type
    await sequelize.query(`
      UPDATE "Operations"
      SET "uploadType" = 'Control deduction'
      WHERE "uploadType" IS NULL;
    `);
    console.log('Successfully updated existing operations with default upload type');

  } catch (error) {
    console.error('Error updating records:', error);
    throw error; // Re-throw to see the full error
  } finally {
    await sequelize.close();
  }
}

updateExistingRecords()
  .then(() => console.log('Migration completed successfully'))
  .catch(error => {
    console.error('Migration failed:', error);
    process.exit(1);
  }); 