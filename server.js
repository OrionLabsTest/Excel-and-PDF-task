const express = require('express');
const multer = require('multer');
const ExcelJS = require('exceljs');
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { timeStamp } = require('console');
require('dotenv').config();
const fs = require('fs').promises;

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(express.json());

// PostgreSQL connection with Sequelize
const sequelize = new Sequelize('postgresql://excelupload2_user:EW3XWWBq36RSzXnVcNpK0MhBBNzJBDjb@dpg-csvk9rlumphs7387c870-a.oregon-postgres.render.com/excelupload2', {
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
  },
  facility: {
    type: DataTypes.ENUM('Main Smartwash', 'Second Smartwash'),
    allowNull: false,
    defaultValue: 'Main Smartwash'
  }
});

// Modify the Operation model
const Operation = sequelize.define('Operation', {
  line: DataTypes.STRING,
  tdate: DataTypes.DATE,
  DESCR: DataTypes.STRING,
  tgap: DataTypes.FLOAT,
  uploadType: {
    type: DataTypes.ENUM('Control deduction', 'Sensor deduction'),
    allowNull: false,
    defaultValue: 'Control deduction'
  }
}, {
  timestamps: true
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
    const { username, password, facility } = req.body;
    
    if (!['Main Smartwash', 'Second Smartwash'].includes(facility)) {
      return res.status(400).send({ message: 'Invalid facility' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      username,
      password: hashedPassword,
      facility
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

    const token = jwt.sign({ id: user.id }, 'your_jwt_secret', { expiresIn: 86400 });
    res.status(200).send({ 
      auth: true, 
      token: token,
      facility: user.facility
    });
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
app.post('/upload/:uploadType', verifyToken, upload.single('excelFile'), async (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    try {
        // Check for existing file with same name
        const existingFile = await UploadedFile.findOne({
            where: {
                originalname: req.file.originalname,
                UserId: req.userId
            }
        });

        if (existingFile) {
            // Delete the uploaded file since we're rejecting it
            await fs.unlink(req.file.path);
            return res.status(400).send('A file with this name has already been uploaded. Please rename the file before uploading.');
        }

        const { uploadType } = req.params;
        
        // Validate upload type
        if (!['Control deduction', 'Sensor deduction'].includes(uploadType)) {
            return res.status(400).send('Invalid upload type.');
        }

        // Validate file name matches upload type
        const fileName = req.file.originalname.toLowerCase();
        const isControlFile = fileName.includes('control');
        const isSensorFile = fileName.includes('sensor');

        if ((uploadType === 'Control deduction' && !isControlFile) || 
            (uploadType === 'Sensor deduction' && !isSensorFile)) {
            return res.status(400).send('File type does not match the upload type.');
        }

        // Get user's facility
        const user = await User.findByPk(req.userId);
        if (!user) {
            return res.status(404).send('User not found.');
        }

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(req.file.path);
        const worksheet = workbook.worksheets[0];

        const operations = {};
        let emptyRowCount = 0;
        const MAX_EMPTY_ROWS = 5;

        for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
            const row = worksheet.getRow(rowNumber);
            
            if (row.values.filter(Boolean).length === 0) {
                emptyRowCount++;
                if (emptyRowCount >= MAX_EMPTY_ROWS) break;
                continue;
            }
            
            emptyRowCount = 0;

            const line = row.getCell(1).value;
            if (!line) continue;

            const operation = {
                line,
                tdate: new Date(row.getCell(2).value),
                DESCR: row.getCell(3).value,
                tgap: row.getCell(6).value,
                UserId: req.userId,
                uploadType: uploadType
            };

            if (!operations[line]) operations[line] = [];
            operations[line].push(operation);
        }

        try {
            await sequelize.transaction(async (t) => {
                for (const lineOperations of Object.values(operations)) {
                    await Operation.bulkCreate(lineOperations, { transaction: t });
                }

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
    } catch (error) {
        console.error('Error processing file:', error);
        res.status(500).send('Error processing file.');
    }
});

// Endpoint to get all data
app.get('/data/:uploadType', verifyToken, async (req, res) => {
    try {
        const { uploadType } = req.params;
        
        // Get user's facility
        const user = await User.findByPk(req.userId);
        if (!user) {
            return res.status(404).send('User not found.');
        }

        // Get all users from the same facility
        const facilityUsers = await User.findAll({
            where: { facility: user.facility },
            attributes: ['id']
        });
        const facilityUserIds = facilityUsers.map(u => u.id);

        const operations = await Operation.findAll({ 
            where: { 
                UserId: facilityUserIds,
                uploadType: uploadType
            } 
        });

        const groupedOperations = operations.reduce((acc, op) => {
            if (!acc[op.line]) {
                acc[op.line] = [];
            }
            acc[op.line].push(op.toJSON());
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
        const uploadType = req.query.uploadType;
        let files;

        // Get all files first
        const allFiles = await UploadedFile.findAll({ 
            where: { UserId: req.userId },
            order: [['createdAt', 'DESC']]
        });

        if (uploadType) {
            // For each file, check if it has operations of the specified type
            const filesWithOperations = await Promise.all(
                allFiles.map(async (file) => {
                    const timeWindow = 5; // 5 seconds window
                    const uploadTime = new Date(file.createdAt);
                    const windowStart = new Date(uploadTime.getTime() - (timeWindow * 1000));
                    const windowEnd = new Date(uploadTime.getTime() + (timeWindow * 1000));

                    const hasOperations = await Operation.findOne({
                        where: {
                            UserId: req.userId,
                            uploadType: uploadType,
                            createdAt: {
                                [Sequelize.Op.between]: [windowStart, windowEnd]
                            }
                        }
                    });

                    return hasOperations ? file : null;
                })
            );

            files = filesWithOperations.filter(file => file !== null);
        } else {
            files = allFiles;
        }
        
        res.json(files);
    } catch (error) {
        console.error('Error fetching files:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update the delete all data endpoint
app.delete('/data/all', verifyToken, async (req, res) => {
    const uploadType = req.query.uploadType; // Get uploadType from query params
    if (!uploadType) {
        return res.status(400).json({ error: 'Upload type is required' });
    }

    try {
        // Get all files for the user with the specified upload type
        const files = await UploadedFile.findAll({
            include: [{
                model: Operation,
                where: { uploadType: uploadType },
                required: true
            }],
            where: { UserId: req.userId }
        });

        // Delete all physical files
        for (const file of files) {
            const filePath = path.join(__dirname, 'uploads', file.filename);
            try {
                await fs.unlink(filePath);
            } catch (unlinkError) {
                console.error(`Error deleting file ${file.filename}:`, unlinkError);
            }
        }

        // Delete all operations of the specified type
        await Operation.destroy({ 
            where: { 
                UserId: req.userId,
                uploadType: uploadType
            } 
        });

        // Delete the file records
        await UploadedFile.destroy({ 
            where: { 
                id: files.map(f => f.id)
            } 
        });

        res.json({ message: `All ${uploadType} data and files deleted successfully` });
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

// Update the single file deletion endpoint
app.delete('/file/:filename', verifyToken, async (req, res) => {
    const filename = req.params.filename;
    const uploadType = req.query.uploadType;
    
    if (!uploadType) {
        return res.status(400).json({ error: 'Upload type is required' });
    }

    try {
        // Start a transaction
        await sequelize.transaction(async (t) => {
            // Find the file record
            const file = await UploadedFile.findOne({ 
                where: { filename, UserId: req.userId },
                transaction: t
            });

            if (!file) {
                return res.status(404).json({ error: "File not found" });
            }

            // Get all operations created within a small time window of the file upload
            // This helps ensure we catch all operations from this file
            const timeWindow = 5; // 5 seconds window
            const uploadTime = new Date(file.createdAt);
            const windowStart = new Date(uploadTime.getTime() - (timeWindow * 1000));
            const windowEnd = new Date(uploadTime.getTime() + (timeWindow * 1000));

            // Delete associated operations of the specified type
            await Operation.destroy({
                where: {
                    UserId: req.userId,
                    uploadType: uploadType,
                    createdAt: {
                        [Sequelize.Op.between]: [windowStart, windowEnd]
                    }
                },
                transaction: t
            });
            
            // Check if there are any remaining operations for this file
            const remainingOperations = await Operation.count({
                where: {
                    UserId: req.userId,
                    createdAt: {
                        [Sequelize.Op.between]: [windowStart, windowEnd]
                    }
                },
                transaction: t
            });

            // Only delete the physical file and file record if no operations remain
            if (remainingOperations === 0) {
                // Delete the physical file
                const filePath = path.join(__dirname, 'uploads', filename);
                try {
                    await fs.unlink(filePath);
                } catch (unlinkError) {
                    console.error('Error deleting physical file:', unlinkError);
                    // Continue with deletion of database record even if file deletion fails
                }
                
                // Delete the file record
                await file.destroy({ transaction: t });
            }
        });
        
        res.json({ message: `File ${filename} and its ${uploadType} data deleted successfully` });
    } catch (error) {
        console.error('Error deleting file:', error);
        res.status(500).json({ error: error.message });
    }
});

// Add new endpoint to get data for a specific file
app.get('/data/file/:filename', verifyToken, async (req, res) => {
    try {
        const uploadType = req.query.uploadType;
        if (!uploadType) {
            return res.status(400).json({ error: "Upload type is required" });
        }

        const file = await UploadedFile.findOne({
            where: { 
                filename: req.params.filename,
                UserId: req.userId
            }
        });

        if (!file) {
            return res.status(404).json({ error: "File not found" });
        }

        // Get operations of the specified type within the upload time window
        const timeWindow = 5; // 5 seconds window
        const uploadTime = new Date(file.createdAt);
        const windowStart = new Date(uploadTime.getTime() - (timeWindow * 1000));
        const windowEnd = new Date(uploadTime.getTime() + (timeWindow * 1000));

        const operations = await Operation.findAll({
            where: {
                UserId: req.userId,
                uploadType: uploadType,
                createdAt: {
                    [Sequelize.Op.between]: [windowStart, windowEnd]
                }
            }
        });

        const groupedOperations = operations.reduce((acc, op) => {
            if (!acc[op.line]) {
                acc[op.line] = [];
            }
            acc[op.line].push(op.toJSON());
            return acc;
        }, {});

        res.json(groupedOperations);
    } catch (error) {
        console.error('Error fetching file data:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update the dashboard endpoint
app.get('/dashboard', verifyToken, async (req, res) => {
    const { startDate, endDate } = req.query;
    const uploadType = req.query.uploadType || 'Control deduction';
    
    try {
        // Get user's facility
        const user = await User.findByPk(req.userId);
        const facilityUsers = await User.findAll({
            where: { facility: user.facility },
            attributes: ['id']
        });
        const facilityUserIds = facilityUsers.map(u => u.id);

        let whereClause = {
            UserId: facilityUserIds,
            uploadType: uploadType
        };

        // If no dates provided, default to today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        if (startDate && endDate) {
            whereClause.tdate = {
                [Sequelize.Op.between]: [new Date(startDate), new Date(endDate)]
            };
        } else {
            whereClause.tdate = {
                [Sequelize.Op.between]: [today, tomorrow]
            };
        }

        // Get all operations for the period
        const operations = await Operation.findAll({
            where: whereClause,
            attributes: [
                'line',
                'tgap',
                [sequelize.fn('COUNT', sequelize.col('id')), 'deductionCount'],
                [sequelize.fn('SUM', sequelize.col('tgap')), 'totalTgap']
            ],
            group: ['line', 'tgap']
        });

        // Process the data
        const lineMetrics = {};
        const allDeductions = [];
        let totalDeductions = 0;
        let totalTgap = 0;
        let deductionsGreaterThanOne = 0;

        operations.forEach(op => {
            const line = op.line;
            const tgap = parseFloat(op.tgap);
            const count = parseInt(op.get('deductionCount'));

            if (!lineMetrics[line]) {
                lineMetrics[line] = {
                    deductionCount: 0,
                    totalMinutes: 0
                };
            }

            lineMetrics[line].deductionCount += count;
            lineMetrics[line].totalMinutes += tgap * count;

            totalDeductions += count;
            totalTgap += tgap * count;
            allDeductions.push(...Array(count).fill(tgap));

            if (tgap > 1) {
                deductionsGreaterThanOne += count;
            }
        });

        // Calculate averages and medians
        const averageDeductions = totalDeductions / Object.keys(lineMetrics).length || 0;
        const medianDeductions = calculateMedian(allDeductions);

        res.json({
            deductionsByLine: Object.fromEntries(
                Object.entries(lineMetrics).map(([line, data]) => [line, data.deductionCount])
            ),
            minutesByLine: Object.fromEntries(
                Object.entries(lineMetrics).map(([line, data]) => [line, data.totalMinutes.toFixed(2)])
            ),
            averageDeductionsToday: averageDeductions.toFixed(2),
            medianDeductions: medianDeductions.toFixed(2),
            deductionsGreaterThanOne,
            cumulativeValueOfDeductions: totalTgap.toFixed(2),
            totalDeductions
        });
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        res.status(500).json({ error: 'Error fetching dashboard data' });
    }
});

// Helper function to calculate median
function calculateMedian(values) {
    if (values.length === 0) return 0;
    values.sort((a, b) => a - b);
    const half = Math.floor(values.length / 2);
    if (values.length % 2) return values[half];
    return (values[half - 1] + values[half]) / 2.0;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
