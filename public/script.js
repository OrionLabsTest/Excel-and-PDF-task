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

async function login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    try {
        const response = await fetch('/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password }),
        });
        const data = await response.json();
        if (data.auth) {
            token = data.token;
            localStorage.setItem('token', token);
            document.getElementById('loginForm').style.display = 'none';
            document.getElementById('mainContent').style.display = 'block';
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
    const authOptions = {
        ...options,
        headers: {
            ...options.headers,
            'Authorization': token,
        },
    };
    return fetch(url, authOptions);
}

fileInput.addEventListener('change', handleFile);

async function handleFile(event) {
    const file = event.target.files[0];
    const formData = new FormData();
    formData.append('excelFile', file);

    // Show loader
    const loader = document.createElement('div');
    loader.id = 'loader';
    loader.innerHTML = 'Uploading...';
    document.body.appendChild(loader);

    try {
        await fetchWithAuth('/upload', {
            method: 'POST',
            body: formData
        });
        // Reload the page after successful upload
        window.location.reload();
    } catch (error) {
        console.error('Error uploading file:', error);
        alert('An error occurred while uploading the file. Please try again.');
    } finally {
        // Remove loader
        document.body.removeChild(loader);
    }
}

async function updateDataAndCharts() {
    try {
        const [dataResponse, filesResponse] = await Promise.all([
            fetchWithAuth('/data'),
            fetchWithAuth('/files')
        ]);
        const data = await dataResponse.json();
        const files = await filesResponse.json();
        const analysis = analyzeData(data);
        createCharts(analysis);
        createFileList(files);
    } catch (error) {
        console.error('Error fetching data:', error);
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
    tableContainer.innerHTML = '';
    
    if (Object.keys(analysis).length === 0) {
        chartGridContainer.innerHTML = '<p>No data available.</p>';
        return;
    }
    
    console.log('Creating charts with analysis:', analysis);

    const toggleButton = document.createElement('button');
    toggleButton.textContent = `Switch to ${currentChartType === 'bar' ? 'Pie' : 'Bar'} Chart`;
    toggleButton.onclick = () => {
        currentChartType = currentChartType === 'bar' ? 'pie' : 'bar';
        createCharts(analysis);
    };
    chartToggleContainer.appendChild(toggleButton);
    
    createCombinedChart(analysis, chartGridContainer);

    allCharts = Object.entries(analysis).map(([line, lineData]) => {
        const lineContainer = document.createElement('div');
        lineContainer.className = 'line-container';
        
        const lineHeader = document.createElement('h2');
        lineHeader.textContent = `Line ${line}`;
        lineContainer.appendChild(lineHeader);

        // Create summary chart for this line
        const summaryChart = createLineSummaryChart(line, lineData);
        lineContainer.appendChild(summaryChart);

        // Create switchable monthly charts for this line
        const monthlyChartsContainer = createSwitchableMonthlyCharts(line, lineData);
        lineContainer.appendChild(monthlyChartsContainer);

        // Create table for this line
        const tableWrapper = createLineTable(line, lineData);
        lineContainer.appendChild(tableWrapper);

        return lineContainer;
    });

    displayPageItems(allCharts, chartGridContainer);
    createPagination(allCharts.length, chartGridContainer);
}

function createCombinedChart(analysis, container) {
    const chartTypes = ['counts', 'timeGaps', 'downtimes'];
    const chartTitles = {
        counts: 'Combined Operation Counts Across All Lines',
        timeGaps: 'Combined Time Gap Sums Across All Lines',
        downtimes: 'Combined Downtime Sums Across All Lines'
    };

    chartTypes.forEach(chartType => {
        const wrapper = document.createElement('div');
        wrapper.className = 'chart-wrapper';
        wrapper.style.width = '100%';
        wrapper.style.height = '400px';

        const canvas = document.createElement('canvas');
        canvas.id = `combined-chart-${chartType}`;
        wrapper.appendChild(canvas);
        container.appendChild(wrapper);

        const datasets = [];
        const labels = new Set();

        Object.entries(analysis).forEach(([line, lineData]) => {
            Object.entries(lineData).forEach(([month, data]) => {
                const operations = Array.from(data.uniqueOperations);
                operations.forEach(op => labels.add(op));
                datasets.push({
                    label: `Line ${line} - ${month}`,
                    data: operations.map(op => {
                        switch(chartType) {
                            case 'counts':
                                return data.operationCounts[op] || 0;
                            case 'timeGaps':
                                return data.timeGapSums[op] || 0;
                            case 'downtimes':
                                return data.downtimeSums[op] || 0;
                        }
                    }),
                    backgroundColor: generateColors(1)[0]
                });
            });
        });

        new Chart(canvas, {
            type: currentChartType,
            data: {
                labels: Array.from(labels),
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    title: {
                        display: true,
                        text: chartTitles[chartType]
                    }
                },
                scales: currentChartType === 'bar' ? {
                    x: { stacked: true },
                    y: { stacked: true, beginAtZero: true }
                } : {}
            }
        });
    });
}

function createMonthlyCharts(line, month, data) {
    console.log(`Creating monthly chart for Line ${line}, ${month}:`, data);
    const operations = Array.from(data.uniqueOperations);
    const counts = operations.map(op => data.operationCounts[op]);
    const timeGaps = operations.map(op => data.timeGapSums[op]);
    const downtimes = operations.map(op => data.downtimeSums[op]);
    
    return [
        createChart(`${line}-${month}-counts`, `Operation Counts - Line ${line}, ${month}`, operations, counts),
        createChart(`${line}-${month}-timegaps`, `Time Gap Sums - Line ${line}, ${month}`, operations, timeGaps),
        createChart(`${line}-${month}-downtimes`, `Downtime Sums - Line ${line}, ${month}`, operations, downtimes)
    ];
}

function createChart(id, title, labels, data) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chart-wrapper';
    
    const canvas = document.createElement('canvas');
    canvas.id = id;
    wrapper.appendChild(canvas);
    
    const total = data.reduce((acc, val) => acc + val, 0);
    const percentages = data.map(value => ((value / total) * 100).toFixed(2));
    
    new Chart(canvas, {
        type: currentChartType,
        data: {
            labels: labels,
            datasets: [{
                label: title,
                data: data,
                backgroundColor: generateColors(data.length),
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: title
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.label || '';
                            const value = context.raw || 0;
                            const percentage = percentages[context.dataIndex];
                            return `${label}: ${value} (${percentage}%)`;
                        }
                    }
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

function createAllMonthsChart(analysis) {
    console.log('Creating all months chart with analysis:', analysis); // Debug log
    if (Object.keys(analysis).length === 0) {
        console.log('No data for all months chart'); // Debug log
        return; // Don't create the chart if there's no data
    }
    
    const allOperations = new Set();
    Object.values(analysis).forEach(monthData => {
        monthData.uniqueOperations.forEach(op => allOperations.add(op));
    });

    const labels = Array.from(allOperations);
    const datasets = Object.entries(analysis).map(([month, data]) => ({
        label: month,
        data: labels.map(op => data.operationCounts[op] || 0),
        backgroundColor: generateColors(1)[0]
    }));

    const wrapper = document.createElement('div');
    wrapper.className = 'chart-wrapper';
    wrapper.style.width = '100%'; // Make this chart full width
    wrapper.style.height = '400px'; // Make this chart taller

    const canvas = document.createElement('canvas');
    canvas.id = 'all-months-chart';
    wrapper.appendChild(canvas);
    chartContainer.appendChild(wrapper);

    new Chart(canvas, {
        type: currentChartType,
        data: {
            labels: labels,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                title: {
                    display: true,
                    text: 'All Months Operation Counts'
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const label = context.dataset.label || '';
                            const value = context.raw || 0;
                            return `${label}: ${value}`;
                        }
                    }
                }
            },
            scales: currentChartType === 'bar' ? {
                x: {
                    stacked: true,
                },
                y: {
                    stacked: true,
                    beginAtZero: true
                }
            } : {}
        }
    });
}

function generateColors(count) {
    const colors = [];
    for (let i = 0; i < count; i++) {
        colors.push(`hsl(${(i * 360) / count}, 70%, 60%)`);
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
    const fileListContainer = document.getElementById('fileListContainer');
    fileListContainer.innerHTML = '<h2>Uploaded Files</h2>';
    const ul = document.createElement('ul');
    files.forEach(file => {
        const li = document.createElement('li');
        li.textContent = file.originalname;
        const deleteButton = document.createElement('button');
        deleteButton.textContent = 'Delete';
        deleteButton.onclick = () => deleteFile(file.filename);
        li.appendChild(deleteButton);
        ul.appendChild(li);
    });
    fileListContainer.appendChild(ul);
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

// Modify your initialization code to check for login status
function initApp() {
    if (isLoggedIn()) {
        document.getElementById('loginForm').style.display = 'none';
        document.getElementById('mainContent').style.display = 'block';
        updateDataAndCharts();
    } else {
        document.getElementById('loginForm').style.display = 'block';
        document.getElementById('mainContent').style.display = 'none';
    }
}

// Call initApp on load
initApp();
