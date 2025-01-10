const fileInput = document.getElementById('fileInput');
const chartContainer = document.getElementById('chartContainer');
const tableContainer = document.getElementById('tableContainer');

let currentChartType = 'bar';

fileInput.addEventListener('change', handleFile);

async function handleFile(event) {
    const file = event.target.files[0];
    const formData = new FormData();
    formData.append('excelFile', file);

    try {
        await fetch('/upload', {
            method: 'POST',
            body: formData
        });
        await updateDataAndCharts();
    } catch (error) {
        console.error('Error uploading file:', error);
    }
}

async function updateDataAndCharts() {
    try {
        const response = await fetch('/data');
        const data = await response.json();
        const analysis = analyzeData(data);
        createCharts(analysis);
        createTable(analysis);
    } catch (error) {
        console.error('Error fetching data:', error);
    }
}

function analyzeData(data) {
    const analysis = {};
    
    data.forEach(row => {
        const month = row.tdate.substring(0, 7); // YYYY-MM
        if (!analysis[month]) {
            analysis[month] = {
                uniqueOperations: new Set(),
                operationCounts: {},
                timeGapSums: {},
                downtimeSums: {}
            };
        }
        
        analysis[month].uniqueOperations.add(row.DESCR);
        analysis[month].operationCounts[row.DESCR] = (analysis[month].operationCounts[row.DESCR] || 0) + 1;
        analysis[month].timeGapSums[row.DESCR] = (analysis[month].timeGapSums[row.DESCR] || 0) + row.tgap;
        analysis[month].downtimeSums[row.DESCR] = (analysis[month].downtimeSums[row.DESCR] || 0) + 
            (new Date(row.nd) - new Date(row.st)) / 60000; // Convert to minutes
    });
    
    return analysis;
}

function createCharts(analysis) {
    chartContainer.innerHTML = ''; // Clear previous charts
    
    // Add chart type toggle button
    const toggleButton = document.createElement('button');
    toggleButton.textContent = `Switch to ${currentChartType === 'bar' ? 'Pie' : 'Bar'} Chart`;
    toggleButton.onclick = () => {
        currentChartType = currentChartType === 'bar' ? 'pie' : 'bar';
        createCharts(analysis);
    };
    chartContainer.appendChild(toggleButton);
    
    Object.entries(analysis).forEach(([month, data]) => {
        createMonthlyCharts(month, data);
    });
}

function createMonthlyCharts(month, data) {
    const operations = Array.from(data.uniqueOperations);
    const counts = operations.map(op => data.operationCounts[op]);
    const timeGaps = operations.map(op => data.timeGapSums[op]);
    const downtimes = operations.map(op => data.downtimeSums[op]);
    
    createChart(`${month}-counts`, 'Operation Counts', operations, counts);
    createChart(`${month}-timegaps`, 'Time Gap Sums', operations, timeGaps);
    // createChart(`${month}-downtimes`, 'Downtime Sums', operations, downtimes);
}

function createChart(id, title, labels, data) {
    const canvas = document.createElement('canvas');
    canvas.id = id;
    chartContainer.appendChild(canvas);
    
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
            plugins: {
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
}

function generateColors(count) {
    const colors = [];
    for (let i = 0; i < count; i++) {
        colors.push(`hsl(${(i * 360) / count}, 70%, 60%)`);
    }
    return colors;
}

function createTable(analysis) {
    tableContainer.innerHTML = ''; // Clear previous table

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

    Object.entries(analysis).forEach(([month, data]) => {
        Array.from(data.uniqueOperations).forEach(op => {
            const row = table.insertRow();
            row.innerHTML = `
                <td>${month}</td>
                <td>${op}</td>
                <td>${data.operationCounts[op]}</td>
                <td>${data.timeGapSums[op].toFixed(2)}</td>
                <td>${data.downtimeSums[op].toFixed(2)}</td>
                <td><button onclick="deleteMonth('${month}')">Delete</button></td>
            `;
        });
    });

    tableContainer.appendChild(table);
}

async function deleteMonth(month) {
    try {
        await fetch(`/data/${month}`, { method: 'DELETE' });
        await updateDataAndCharts();
    } catch (error) {
        console.error('Error deleting month:', error);
    }
}

// Initial load of data and charts
updateDataAndCharts();
