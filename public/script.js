const fileInput = document.getElementById('fileInput');
const chartContainer = document.getElementById('chartContainer');
const tableContainer = document.getElementById('tableContainer');
const paginationContainer = document.getElementById('paginationContainer');

let currentChartType = 'bar';
let currentPage = 1;
const itemsPerPage = 1; // Number of charts or tables per page

let allCharts = []; // Global variable to store all charts

// Add these at the beginning of your script.js file
let token = localStorage.getItem('token');

// Add these variables at the top
let currentView = 'raw';
let currentStartDate = null;
let currentEndDate = null;

async function login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const facility = document.getElementById('facility').value;
    
    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password, facility }),
        });
        const data = await response.json();
        if (data.auth) {
            token = data.token;
            localStorage.setItem('token', token);
            localStorage.setItem('facility', facility);
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('mainContent').style.display = 'block';
            document.getElementById('uploadType').value = 'Control deduction';
            updateDataAndCharts();
        } else {
            alert('Login failed. Please try again.');
        }
    } catch (error) {
        console.error('Login error:', error);
        alert('An error occurred during login. Please try again.');
    }
}

function logout() {
    token = null;
    localStorage.removeItem('token');
    document.getElementById('mainContent').style.display = 'none';
    document.getElementById('loginForm').style.display = 'block';
}

// Modify your existing fetch calls to include the token in the headers
async function fetchWithAuth(url, options = {}) {
    if (!token) {
        throw new Error('No authentication token');
    }

    // Don't modify headers if we're sending FormData
    if (options.body instanceof FormData) {
        return fetch(url, {
            ...options,
            headers: {
                'Authorization': token,
                ...options.headers
            }
        });
    }

    // For regular JSON requests
    return fetch(url, {
        ...options,
        headers: {
            ...options.headers,
            'Authorization': token,
            'Content-Type': 'application/json'
        }
    }).then(response => {
        if (response.status === 401) {
            logout();
            window.location.href = '/login';
        }
        return response;
    });
}

fileInput.addEventListener('change', handleFile);

async function handleFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const uploadType = document.getElementById('uploadType').value;
    if (!uploadType) {
        alert('Please select an upload type');
        event.target.value = '';
        return;
    }

    const formData = new FormData();
    formData.append('excelFile', file);

    const loader = document.createElement('div');
    loader.id = 'loader';
    loader.innerHTML = 'Uploading...';
    document.body.appendChild(loader);

    try {
        const response = await fetchWithAuth(`/upload/${uploadType}`, {
            method: 'POST',
            body: formData,
            headers: {
                'Authorization': token
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText);
        }

        alert('File uploaded successfully');
        window.location.reload();
    } catch (error) {
        console.error('Error uploading file:', error);
        alert(error.message || 'An error occurred while uploading the file. Please try again.');
    } finally {
        if (document.getElementById('loader')) {
            document.body.removeChild(loader);
        }
        event.target.value = '';
    }
}

// Add event listener for upload type change
document.getElementById('uploadType').addEventListener('change', () => {
    // Clear file input when upload type changes
    document.getElementById('fileInput').value = '';
});

async function updateDataAndCharts() {
    const chartLoader = document.getElementById('chartLoader');
    chartLoader.style.display = 'flex';
    
    try {
        const uploadType = document.getElementById('uploadType').value;
        if (!uploadType) {
            console.log('No upload type selected');
            return;
        }

        const [dataResponse, filesResponse] = await Promise.all([
            fetchWithAuth(`/data/${uploadType}`),
            fetchWithAuth('/files')
        ]);
        
        if (!dataResponse.ok || !filesResponse.ok) {
            throw new Error('Failed to fetch data');
        }

        const data = await dataResponse.json();
        const files = await filesResponse.json();
        
        // Filter data based on date range if set
        const filteredData = filterDataByDateRange(data);
        console.log('Filtered data:', filteredData); // Debug log
        
        const analysis = analyzeData(filteredData);
        console.log('Analyzed data:', analysis); // Debug log
        
        createCharts(analysis);
        createFileList(files);
    } catch (error) {
        console.error('Error fetching data:', error);
    } finally {
        chartLoader.style.display = 'none';
    }
}

function analyzeData(data) {
    const analysis = {};
    
    Object.entries(data).forEach(([line, operations]) => {
        analysis[line] = {};
        operations.forEach(row => {
            const month = row.tdate.substring(0, 7); // YYYY-MM
            if (!analysis[line][month]) {
                analysis[line][month] = {
                    uniqueOperations: new Set(),
                    operationCounts: {},
                    timeGapSums: {},
                    downtimeSums: {}
                };
            }
            
            analysis[line][month].uniqueOperations.add(row.DESCR);
            analysis[line][month].operationCounts[row.DESCR] = (analysis[line][month].operationCounts[row.DESCR] || 0) + 1;
            analysis[line][month].timeGapSums[row.DESCR] = (analysis[line][month].timeGapSums[row.DESCR] || 0) + row.tgap;
            analysis[line][month].downtimeSums[row.DESCR] = (analysis[line][month].downtimeSums[row.DESCR] || 0) + 
                (new Date(row.nd) - new Date(row.st)) / 60000; // Convert to minutes
        });
    });
    
    return analysis;
}

function createCharts(analysis) {
    const chartToggleContainer = document.getElementById('chartToggleContainer');
    const chartGridContainer = document.getElementById('chartGridContainer');
    
    chartToggleContainer.innerHTML = '';
    chartGridContainer.innerHTML = '';
    
    if (Object.keys(analysis).length === 0) {
        chartGridContainer.innerHTML = '<p>No data available.</p>';
        return;
    }

    // Add chart type toggle button
    const toggleButton = document.createElement('button');
    toggleButton.textContent = `Switch to ${currentChartType === 'bar' ? 'Pie' : 'Bar'} Chart`;
    toggleButton.onclick = () => {
        currentChartType = currentChartType === 'bar' ? 'pie' : 'bar';
        createCharts(analysis);
    };
    chartToggleContainer.appendChild(toggleButton);

    // Create charts for each line
    allCharts = Object.entries(analysis).map(([line, lineData]) => {
        const lineContainer = document.createElement('div');
        lineContainer.className = 'line-container';
        
        const lineHeader = document.createElement('h2');
        lineHeader.textContent = `Line ${line}`;
        lineContainer.appendChild(lineHeader);

        // Create summary charts
        const summaryCharts = createLineSummaryCharts(line, lineData);
        lineContainer.appendChild(summaryCharts);

        // Create monthly charts
        const monthlyCharts = createMonthlyCharts(line, lineData);
        lineContainer.appendChild(monthlyCharts);

        return lineContainer;
    });

    displayPageItems(allCharts, chartGridContainer);
    createPagination(allCharts.length, chartGridContainer);
}

function createLineSummaryCharts(line, lineData) {
    const container = document.createElement('div');
    container.className = 'summary-charts';

    // Aggregate data across all months
    const aggregatedData = {
        operationCounts: {},
        timeGapSums: {},
        downtimeSums: {}
    };

    Object.values(lineData).forEach(monthData => {
        Object.entries(monthData.operationCounts).forEach(([op, count]) => {
            aggregatedData.operationCounts[op] = (aggregatedData.operationCounts[op] || 0) + count;
        });
        Object.entries(monthData.timeGapSums).forEach(([op, sum]) => {
            aggregatedData.timeGapSums[op] = (aggregatedData.timeGapSums[op] || 0) + sum;
        });
        Object.entries(monthData.downtimeSums).forEach(([op, sum]) => {
            aggregatedData.downtimeSums[op] = (aggregatedData.downtimeSums[op] || 0) + sum;
        });
    });

    // Create charts for each metric
    const metrics = [
        { title: 'Operation Counts', data: aggregatedData.operationCounts },
        { title: 'Time Gap Sums', data: aggregatedData.timeGapSums },
        { title: 'Downtime Sums', data: aggregatedData.downtimeSums }
    ];

    metrics.forEach(metric => {
        const chartWrapper = document.createElement('div');
        chartWrapper.className = 'chart-wrapper';
        
        const canvas = document.createElement('canvas');
        new Chart(canvas, {
            type: currentChartType,
            data: {
                labels: Object.keys(metric.data),
                datasets: [{
                    label: metric.title,
                    data: Object.values(metric.data),
                    backgroundColor: generateColors(Object.keys(metric.data).length)
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: `${metric.title} - Line ${line}`
                    }
                }
            }
        });

        chartWrapper.appendChild(canvas);
        container.appendChild(chartWrapper);
    });

    return container;
}

function createMonthlyCharts(line, lineData) {
    const container = document.createElement('div');
    container.className = 'monthly-charts';

    Object.entries(lineData).forEach(([month, data]) => {
        const monthContainer = document.createElement('div');
        monthContainer.className = 'month-container';
        
        const monthHeader = document.createElement('h3');
        monthHeader.textContent = month;
        monthContainer.appendChild(monthHeader);

        const metrics = [
            { title: 'Operation Counts', data: data.operationCounts },
            { title: 'Time Gap Sums', data: data.timeGapSums },
            { title: 'Downtime Sums', data: data.downtimeSums }
        ];

        metrics.forEach(metric => {
            const chartWrapper = document.createElement('div');
            chartWrapper.className = 'chart-wrapper';
            
            const canvas = document.createElement('canvas');
            new Chart(canvas, {
                type: currentChartType,
                data: {
                    labels: Object.keys(metric.data),
                    datasets: [{
                        label: metric.title,
                        data: Object.values(metric.data),
                        backgroundColor: generateColors(Object.keys(metric.data).length)
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        title: {
                            display: true,
                            text: `${metric.title} - ${month}`
                        }
                    }
                }
            });

            chartWrapper.appendChild(canvas);
            monthContainer.appendChild(chartWrapper);
        });

        container.appendChild(monthContainer);
    });

    return container;
}

function generateColors(count) {
    const colors = [];
    for (let i = 0; i < count; i++) {
        const hue = (i * 360) / count;
        colors.push(`hsla(${hue}, 70%, 60%, 0.8)`);
    }
    return colors;
}

const deleteAllButton = document.getElementById('deleteAllButton');
deleteAllButton.addEventListener('click', deleteAllData);

async function deleteAllData() {
    if (confirm("Are you sure you want to delete all data? This action cannot be undone.")) {
        try {
            const response = await fetchWithAuth('/data/all', { method: 'DELETE' });
            if (!response.ok) {
                throw new Error('Failed to delete all data');
            }
            await updateDataAndCharts();
            alert("All data has been deleted successfully.");
            window.location.reload();
        } catch (error) {
            console.error('Error deleting all data:', error);
            alert("An error occurred while deleting data.");
        }
    }
}

function createTable(analysis) {
    tableContainer.innerHTML = ''; // Clear previous table

    if (Object.keys(analysis).length === 0) {
        tableContainer.innerHTML = '<p>No data available.</p>';
        return;
    }

    const allTables = Object.entries(analysis).map(([line, lineData]) => {
        const tableWrapper = document.createElement('div');
        const lineHeader = document.createElement('h2');
        lineHeader.textContent = `Line ${line}`;
        tableWrapper.appendChild(lineHeader);

        const table = document.createElement('table');
        table.innerHTML = `
            <tr>
                <th>Month</th>
                <th>Operation</th>
                <th>Count</th>
                <th>Time Gap Sum</th>
                <th>Downtime Sum</th>
                <th>Action</th>
            </tr>
        `;

        const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM

        Object.entries(lineData).forEach(([month, data]) => {
            Array.from(data.uniqueOperations).forEach(op => {
                const row = table.insertRow();
                row.innerHTML = `
                    <td>${month}${month === currentMonth ? ' (Current)' : ''}</td>
                    <td>${op}</td>
                    <td>${data.operationCounts[op]}</td>
                    <td>${data.timeGapSums[op].toFixed(2)}</td>
                    <td>${data.downtimeSums[op].toFixed(2)}</td>
                    <td><button onclick="deleteMonth('${line}', '${month}')">Delete</button></td>
                `;
            });
        });

        tableWrapper.appendChild(table);
        return tableWrapper;
    });

    displayPageItems(allTables, tableContainer);
    createPagination(allTables.length, tableContainer);
}

async function deleteMonth(line, month) {
    try {
        await fetchWithAuth(`/data/${line}/${month}`, { method: 'DELETE' });
        await updateDataAndCharts();
    } catch (error) {
        console.error('Error deleting month:', error);
    }
}

function createFileList(files) {
    const container = document.getElementById('fileListContainer');
    if (!files.length) {
        container.innerHTML = '<p>No files uploaded yet</p>';
        return;
    }

    const table = document.createElement('table');
    table.className = 'excel-table';
    table.innerHTML = `
        <tr>
            <th>File Name</th>
            <th>Upload Date</th>
            <th>Actions</th>
        </tr>
    `;

    // Filter files based on date range
    const filteredFiles = files.filter(file => {
        if (!currentStartDate || !currentEndDate) return true;
        
        const fileDate = new Date(file.createdAt);
        const startDate = new Date(currentStartDate);
        const endDate = new Date(currentEndDate);
        endDate.setHours(23, 59, 59, 999);
        
        return fileDate >= startDate && fileDate <= endDate;
    });

    filteredFiles.forEach(file => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${file.originalname}</td>
            <td>${new Date(file.createdAt).toLocaleString()}</td>
            <td>
                <button onclick="viewFileData('${file.filename}')">View Data</button>
                <button onclick="deleteFile('${file.filename}')">Delete</button>
            </td>
        `;
        table.appendChild(row);
    });

    container.innerHTML = '';
    container.appendChild(table);
}

async function deleteFile(filename) {
    if (confirm(`Are you sure you want to delete the file and its data? This action cannot be undone.`)) {
        try {
            const response = await fetchWithAuth(`/file/${filename}`, { method: 'DELETE' });
            if (!response.ok) {
                throw new Error('Failed to delete file');
            }
            await updateDataAndCharts();
            alert("File and its data have been deleted successfully.");
            window.location.reload();
        } catch (error) {
            console.error('Error deleting file:', error);
            alert("An error occurred while deleting the file.");
        }
    }
}

function displayPageItems(items, container) {
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageItems = items.slice(startIndex, endIndex);

    // Clear the container
    container.innerHTML = '';

    pageItems.forEach(item => container.appendChild(item));
}

function createPagination(totalItems, container) {
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    paginationContainer.innerHTML = '';

    if (totalPages <= 1) return; // Don't show pagination if there's only one page

    // Add "Previous" button
    const prevButton = document.createElement('button');
    prevButton.textContent = 'Previous Line';
    prevButton.onclick = () => {
        if (currentPage > 1) {
            currentPage--;
            displayPageItems(allCharts, container);
            createPagination(totalItems, container);
        }
    };
    paginationContainer.appendChild(prevButton);

    // Add page number buttons
    for (let i = 1; i <= totalPages; i++) {
        const button = document.createElement('button');
        button.textContent = `Line ${i}`;
        button.onclick = () => {
            currentPage = i;
            displayPageItems(allCharts, container);
            createPagination(totalItems, container);
        };
        if (i === currentPage) {
            button.disabled = true;
        }
        paginationContainer.appendChild(button);
    }

    // Add "Next" button
    const nextButton = document.createElement('button');
    nextButton.textContent = 'Next Line';
    nextButton.onclick = () => {
        if (currentPage < totalPages) {
            currentPage++;
            displayPageItems(allCharts, container);
            createPagination(totalItems, container);
        }
    };
    paginationContainer.appendChild(nextButton);
}

function createLineTable(line, lineData) {
    const tableWrapper = document.createElement('div');
    const table = document.createElement('table');
    table.innerHTML = `
        <tr>
            <th>Month</th>
            <th>Operation</th>
            <th>Count</th>
            <th>Time Gap Sum</th>
            <th>Downtime Sum</th>
            <th>Action</th>
        </tr>
    `;

    const currentMonth = new Date().toISOString().substring(0, 7); // YYYY-MM

    Object.entries(lineData).forEach(([month, data]) => {
        Array.from(data.uniqueOperations).forEach(op => {
            const row = table.insertRow();
            row.innerHTML = `
                <td>${month}${month === currentMonth ? ' (Current)' : ''}</td>
                <td>${op}</td>
                <td>${data.operationCounts[op]}</td>
                <td>${data.timeGapSums[op].toFixed(2)}</td>
                <td>${data.downtimeSums[op].toFixed(2)}</td>
                <td><button onclick="deleteMonth('${line}', '${month}')">Delete</button></td>
            `;
        });
    });

    tableWrapper.appendChild(table);
    return tableWrapper;
}

function createLineSummaryChart(line, lineData) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-wrapper';
    
    const canvas = document.createElement('canvas');
    canvas.id = `summary-${line}`;
    wrapper.appendChild(canvas);

    const allOperations = new Set();
    const totalCounts = {};
    const totalTimeGaps = {};
    const totalDowntimes = {};

    Object.values(lineData).forEach(monthData => {
        monthData.uniqueOperations.forEach(op => {
            allOperations.add(op);
            totalCounts[op] = (totalCounts[op] || 0) + monthData.operationCounts[op];
            totalTimeGaps[op] = (totalTimeGaps[op] || 0) + monthData.timeGapSums[op];
            totalDowntimes[op] = (totalDowntimes[op] || 0) + monthData.downtimeSums[op];
        });
    });

    const operations = Array.from(allOperations);
    const counts = operations.map(op => totalCounts[op]);
    const timeGaps = operations.map(op => totalTimeGaps[op]);
    const downtimes = operations.map(op => totalDowntimes[op]);

    new Chart(canvas, {
        type: currentChartType,
        data: {
            labels: operations,
            datasets: [
                {
                    label: 'Total Counts',
                    data: counts,
                    backgroundColor: 'rgba(75, 192, 192, 0.6)',
                },
                {
                    label: 'Total Time Gaps',
                    data: timeGaps,
                    backgroundColor: 'rgba(255, 159, 64, 0.6)',
                },
                {
                    label: 'Total Downtimes',
                    data: downtimes,
                    backgroundColor: 'rgba(255, 99, 132, 0.6)',
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: `Summary for Line ${line}`
                }
            },
            scales: currentChartType === 'bar' ? {
                y: {
                    beginAtZero: true
                }
            } : {}
        }
    });

    return wrapper;
}

function createSwitchableMonthlyCharts(line, lineData) {
    const container = document.createElement('div');
    container.className = 'switchable-charts-container';

    const monthSelect = document.createElement('select');
    Object.keys(lineData).forEach(month => {
        const option = document.createElement('option');
        option.value = month;
        option.textContent = month;
        monthSelect.appendChild(option);
    });

    const chartContainer = document.createElement('div');
    chartContainer.className = 'chart-container';

    monthSelect.addEventListener('change', () => {
        const selectedMonth = monthSelect.value;
        updateMonthlyCharts(line, selectedMonth, lineData[selectedMonth], chartContainer);
    });

    container.appendChild(monthSelect);
    container.appendChild(chartContainer);

    // Initialize with the first month
    const firstMonth = Object.keys(lineData)[0];
    updateMonthlyCharts(line, firstMonth, lineData[firstMonth], chartContainer);

    return container;
}

function updateMonthlyCharts(line, month, data, container) {
    container.innerHTML = '';
    const charts = createMonthlyCharts(line, month, data);
    charts.forEach(chart => container.appendChild(chart));
}

// Initial load of data and charts
updateDataAndCharts();

// Add a function to check if the user is logged in
function isLoggedIn() {
    return !!token;
}

// Update the header based on facility and upload type
function updateHeader() {
    const facility = localStorage.getItem('facility');
    const uploadType = document.getElementById('uploadType').value;
    const header = document.getElementById('facilityHeader');
    if (facility && uploadType) {
        header.textContent = `${uploadType} - ${facility}`;
    }
}

// Toggle between raw data and visualizations
document.getElementById('viewRawData').addEventListener('click', function() {
    this.classList.add('active');
    document.getElementById('viewVisualizations').classList.remove('active');
    document.getElementById('rawDataView').style.display = 'block';
    document.getElementById('visualizationView').style.display = 'none';
    currentView = 'raw';
    updateDisplay();
});

document.getElementById('viewVisualizations').addEventListener('click', function() {
    this.classList.add('active');
    document.getElementById('viewRawData').classList.remove('active');
    document.getElementById('rawDataView').style.display = 'none';
    document.getElementById('visualizationView').style.display = 'block';
    currentView = 'visualization';
    updateDisplay();
});

// Handle date filter
function applyDateFilter() {
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    
    if (!startDateInput.value || !endDateInput.value) {
        alert('Please select both start and end dates');
        return;
    }
    
    currentStartDate = startDateInput.value;
    currentEndDate = endDateInput.value;
    
    // Update both views
    updateDisplay();
}

// Update the display based on current view and filters
async function updateDisplay() {
    updateHeader();
    updateDateFilterControls();
    const uploadType = document.getElementById('uploadType').value;
    
    if (currentView === 'raw') {
        await displayRawData(uploadType);
    } else {
        await updateDataAndCharts();
    }
}

// Display raw Excel data
async function displayRawData(uploadType) {
    const container = document.getElementById('excelDataContainer');
    container.innerHTML = '<div class="loader">Loading data...</div>';

    try {
        const response = await fetchWithAuth(`/data/${uploadType}`);
        const data = await response.json();

        // Filter data based on date range if set
        const filteredData = filterDataByDateRange(data);
        
        // Create table from data
        const table = createDataTable(filteredData);
        container.innerHTML = '';
        container.appendChild(table);
    } catch (error) {
        console.error('Error loading raw data:', error);
        container.innerHTML = 'Error loading data';
    }
}

// Create table from data
function createDataTable(data) {
    const table = document.createElement('table');
    table.className = 'excel-table';

    // Create headers
    const headers = ['Line', 'Date', 'Description', 'Time Gap'];
    const headerRow = document.createElement('tr');
    headers.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header;
        headerRow.appendChild(th);
    });
    table.appendChild(headerRow);

    // Add data rows
    Object.entries(data).forEach(([line, operations]) => {
        operations.forEach(op => {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td>${line}</td>
                <td>${new Date(op.tdate).toLocaleDateString()}</td>
                <td>${op.DESCR}</td>
                <td>${op.tgap}</td>
            `;
            table.appendChild(row);
        });
    });

    return table;
}

// Filter data by date range
function filterDataByDateRange(data) {
    if (!currentStartDate || !currentEndDate) return data;

    const startDate = new Date(currentStartDate);
    const endDate = new Date(currentEndDate);
    // Set endDate to end of day to include the entire last day
    endDate.setHours(23, 59, 59, 999);

    const filtered = {};
    Object.entries(data).forEach(([line, operations]) => {
        filtered[line] = operations.filter(op => {
            const opDate = new Date(op.tdate);
            return opDate >= startDate && opDate <= endDate;
        });
        // Only keep lines that have operations after filtering
        if (filtered[line].length === 0) delete filtered[line];
    });

    return filtered;
}

// Update the upload type change handler
document.getElementById('uploadType').addEventListener('change', () => {
    document.getElementById('fileInput').value = '';
    updateHeader();
    updateDisplay();
});

// Initialize the app with these new features
function initApp() {
    if (isLoggedIn()) {
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('mainContent').style.display = 'block';
        const uploadType = document.getElementById('uploadType');
        if (!uploadType.value) {
            uploadType.value = 'Control deduction';
        }
        updateHeader();
        updateDisplay();
    } else {
        document.getElementById('loginForm').style.display = 'block';
        document.getElementById('mainContent').style.display = 'none';
    }
}

// Call initApp on load
initApp();

// Add function to view file data
async function viewFileData(filename) {
    const chartLoader = document.getElementById('chartLoader');
    chartLoader.style.display = 'flex';

    try {
        const response = await fetchWithAuth(`/data/file/${filename}`);
        if (!response.ok) {
            throw new Error('Failed to fetch file data');
        }

        const data = await response.json();
        
        // Switch to visualization view
        document.getElementById('viewVisualizations').click();
        
        // Update the charts with the file's data
        const analysis = analyzeData(data);
        createCharts(analysis);

        // Update raw data view as well
        const table = createDataTable(data);
        document.getElementById('excelDataContainer').innerHTML = '';
        document.getElementById('excelDataContainer').appendChild(table);

    } catch (error) {
        console.error('Error loading file data:', error);
        alert('Error loading file data');
    } finally {
        chartLoader.style.display = 'none';
    }
}

// Add clearDateFilter function
function clearDateFilter() {
    currentStartDate = null;
    currentEndDate = null;
    
    // Clear input fields
    document.getElementById('startDate').value = '';
    document.getElementById('endDate').value = '';
    
    // Update all views
    updateDisplay();
}

// Modify the date range container HTML in index.html to include the clear button
// Add this to the existing date-range-container div:
function updateDateFilterControls() {
    const container = document.querySelector('.date-range-container');
    container.innerHTML = `
        <label>Date Range:</label>
        <input type="date" id="startDate" ${currentStartDate ? `value="${currentStartDate}"` : ''}>
        <input type="date" id="endDate" ${currentEndDate ? `value="${currentEndDate}"` : ''}>
        <button onclick="applyDateFilter()">Apply Filter</button>
        <button onclick="clearDateFilter()">Clear Filter</button>
        ${currentStartDate && currentEndDate ? 
            `<span class="active-filter">
                Filtered: ${new Date(currentStartDate).toLocaleDateString()} - 
                ${new Date(currentEndDate).toLocaleDateString()}
            </span>` 
            : ''}
    `;
}

// Add some CSS for the active filter indicator
const style = document.createElement('style');
style.textContent = `
    .active-filter {
        margin-left: 10px;
        padding: 4px 8px;
        background-color: #e0e0e0;
        border-radius: 4px;
        font-size: 0.9em;
    }
`;
document.head.appendChild(style);
