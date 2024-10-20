const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { timeStamp } = require('console');
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());

// PostgreSQL connection with Sequelize
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  dialect: 'postgres',
  dialectOptions: {
    ssl: {
      require: true,
      rejectUnauthorized: false
    }
  }
});

// User model
const User = sequelize.define('User', {
  username: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  }
});

// Modify the Operation model to include user association and enable timestamps
const Operation = sequelize.define('Operation', {
  line: DataTypes.STRING,
  tdate: DataTypes.DATE,
  DESCR: DataTypes.STRING,
  st: DataTypes.DATE,
  nd: DataTypes.DATE,
  tgap: DataTypes.FLOAT,
  downtime: DataTypes.FLOAT // Add this field to store calculated downtime
}, {
  timestamps: true // This enables createdAt and updatedAt
});

// Add user association to UploadedFile model
const UploadedFile = sequelize.define('UploadedFile', {
  filename: DataTypes.STRING,
  originalname: DataTypes.STRING
});

// Set up associations
User.hasMany(Operation);
Operation.belongsTo(User);
User.hasMany(UploadedFile);
UploadedFile.belongsTo(User);

// Sync the models with the database
sequelize.sync({ alter: true }).then(() => {
    console.log('Database & tables created!');
}).catch((error) => {
    console.error('Error syncing database:', error);
});

// Middleware to verify JWT
const verifyToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.status(403).send({ auth: false, message: 'No token provided.' });
  
  jwt.verify(token, 'your_jwt_secret', (err, decoded) => {
    if (err) return res.status(500).send({ auth: false, message: 'Failed to authenticate token.' });
    
    req.userId = decoded.id;
    next();
  });
};

// Serve static files from the 'public' directory
app.use(express.static('public'));

// User registration
app.post('/register', async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const user = await User.create({
      username: req.body.username,
      password: hashedPassword
    });
    res.status(201).send({ message: 'User registered successfully' });
  } catch (error) {
    res.status(500).send({ message: 'Error registering user', error: error.message });
  }
});

// User login
app.post('/login', async (req, res) => {
  try {
    const user = await User.findOne({ where: { username: req.body.username } });
    if (!user) return res.status(404).send({ message: 'User not found' });

    const validPassword = await bcrypt.compare(req.body.password, user.password);
    if (!validPassword) return res.status(401).send({ auth: false, token: null });

    const token = jwt.sign({ id: user.id }, 'your_jwt_secret', { expiresIn: 86400 }); // expires in 24 hours
    res.status(200).send({ auth: true, token: token });
  } catch (error) {
    res.status(500).send({ message: 'Error on the server.', error: error.message });
  }
});

// Logout (client-side only, just for completeness)
app.post('/logout', (req, res) => {
  res.status(200).send({ auth: false, token: null });
});

// Protected route example
app.get('/me', verifyToken, async (req, res) => {
  try {
    const user = await User.findByPk(req.userId, { attributes: { exclude: ['password'] } });
    if (!user) return res.status(404).send({ message: 'No user found.' });
    res.status(200).send(user);
  } catch (error) {
    res.status(500).send({ message: 'There was a problem finding the user.', error: error.message });
  }
});

// Endpoint to handle file upload
app.post('/upload', verifyToken, upload.single('excelFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);
    const worksheet = workbook.worksheets[0];

    const operations = [];
    worksheet.eachRow((row, rowNumber) => {
        if (rowNumber > 1) { // Skip header row
            const st = new Date(row.getCell(4).value);
            const nd = new Date(row.getCell(5).value);
            const downtime = (nd - st) / 1000; // Calculate downtime in seconds
            operations.push({
                line: row.getCell(1).value,
                tdate: new Date(row.getCell(2).value),
                DESCR: row.getCell(3).value,
                st: st,
                nd: nd,
                tgap: row.getCell(6).value,
                downtime: downtime,
                UserId: req.userId
            });
        }
    });

    try {
        // Use a transaction to ensure data consistency
        await sequelize.transaction(async (t) => {
            for (const op of operations) {
                // Try to find an existing operation with the same line, start date, and end date
                const existingOp = await Operation.findOne({
                    where: {
                        line: op.line,
                        st: op.st,
                        nd: op.nd,
                        UserId: req.userId
                    },
                    transaction: t
                });

                if (existingOp) {
                    // If found, update the existing record
                    await existingOp.update(op, { transaction: t });
                } else {
                    // If not found, create a new record
                    await Operation.create(op, { transaction: t });
                }
            }

            // Create a record of the uploaded file
            await UploadedFile.create({
                filename: req.file.filename,
                originalname: req.file.originalname,
                UserId: req.userId
            }, { transaction: t });
        });

        res.send('File uploaded and processed successfully.');
    } catch (error) {
        console.error('Error processing file:', error);
        res.status(500).send('Error processing file.');
    }
});

// Endpoint to get all data
app.get('/data', verifyToken, async (req, res) => {
    try {
        const operations = await Operation.findAll({ where: { UserId: req.userId } });
        const groupedOperations = operations.reduce((acc, op) => {
            if (!acc[op.line]) {
                acc[op.line] = [];
            }
            acc[op.line].push({
                ...op.toJSON(),
                downtime: op.downtime // Use the stored downtime value
            });
            return acc;
        }, {});
        res.json(groupedOperations);
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to get list of uploaded files
app.get('/files', verifyToken, async (req, res) => {
    try {
        const files = await UploadedFile.findAll({ where: { UserId: req.userId } });
        res.json(files);
    } catch (error) {
        console.error('Error fetching files:', error);
        res.status(500).json({ error: error.message });
    }
});

// Endpoint to delete all data
app.delete('/data/all', verifyToken, async (req, res) => {
    try {
        await Operation.destroy({ where: { UserId: req.userId } });
        await UploadedFile.destroy({ where: { UserId: req.userId } });
        res.json({ message: "All data deleted successfully" });
    } catch (error) {
        console.error('Error deleting all data:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update the delete endpoint in server.js
app.delete('/data/:line/:month', verifyToken, async (req, res) => {
    const { line, month } = req.params;
    if (!/^\d{4}-\d{2}$/.test(month)) {
        return res.status(400).json({ error: "Invalid month format. Use YYYY-MM" });
    }
    try {
        const result = await Operation.destroy({
            where: {
                line: line,
                UserId: req.userId,
                [Sequelize.Op.and]: [
                    sequelize.where(sequelize.fn('date_trunc', 'month', sequelize.col('tdate')), '=', month)
                ]
            }
        });
        res.json({ message: `Deleted data for Line ${line}, month ${month}`, rowsAffected: result });
    } catch (error) {
        console.error('Error deleting data:', error);
        res.status(500).json({ error: error.message });
    }
});

// New endpoint to delete a specific file and its data
app.delete('/file/:filename', verifyToken, async (req, res) => {
    const filename = req.params.filename;
    try {
        const file = await UploadedFile.findOne({ where: { filename, UserId: req.userId } });
        if (!file) {
            return res.status(404).json({ error: "File not found" });
        }
        
        // Delete associated operations
        await Operation.destroy({
            where: {
                UserId: req.userId,
                createdAt: {
                    [Sequelize.Op.between]: [file.createdAt, file.updatedAt]
                }
            }
        });
        
        // Delete the file record
        await file.destroy();
        
        res.json({ message: `File ${filename} and its data deleted successfully` });
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
