document.addEventListener('DOMContentLoaded', () => {
    initMaps();

    const showWavesCheckbox = document.getElementById('showWaves');
    if (showWavesCheckbox) {
        showWavesCheckbox.addEventListener('change', () => {
            if (window.myChart) {
                window.myChart.update();
            }
        });
    }
});

function initMaps() {
    const center = [START_LAT, START_LNG];

    miniMap = L.map('miniMap').setView(center, START_ZOOM);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(miniMap);
    selectionLayer.addTo(miniMap);

    miniMap.on('click', (e) => {
        const size = parseInt(document.getElementById('gridSize').value);
        const h3Index = h3.latLngToCell(e.latlng.lat, e.latlng.lng, size);

        if (selectedH3Indices.has(h3Index)) {
            selectedH3Indices.delete(h3Index);
        } else {
            if (selectedH3Indices.size >= 100) return;
            selectedH3Indices.add(h3Index);
        }
        drawSelection();
    });

    resultMap = L.map('resultMap').setView(center, START_ZOOM);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(resultMap);
    resultLayer.addTo(resultMap);
}

function toggleMapFullscreen() {
    const mapContainer = document.getElementById('resultMap');
    const btn = document.getElementById('toggleFullscreen');

    mapContainer.classList.toggle('fullscreen-map');

    if (mapContainer.classList.contains('fullscreen-map')) {
        btn.innerText = 'Свернуть ✖';
        btn.style.position = 'fixed';
        btn.style.top = '20px';
        btn.style.right = '20px';
        btn.style.zIndex = '10000';
    } else {
        btn.innerText = 'Во весь экран ⛶';
        btn.style.position = 'static';
        btn.style.zIndex = 'auto';
    }

    setTimeout(() => {
        resultMap.invalidateSize();
    }, 150);
}

function drawSelection() {
    selectionLayer.clearLayers();
    selectedH3Indices.forEach(index => {
        const boundary = h3.cellToBoundary(index);
        L.polygon(boundary, {
            color: '#007bff', fillColor: '#007bff', fillOpacity: 0.4, weight: 1
        }).addTo(selectionLayer);
    });
}

function clearSelection() {
    selectedH3Indices.clear();
    selectionLayer.clearLayers();
}

function clearResults() {
    document.getElementById('resultsList').innerHTML = '';
    resultLayer.clearLayers();
    document.getElementById('toggleFullscreen').style.display = 'none';

    const chartEl = document.getElementById('resultChart');
    if (chartEl) chartEl.style.display = 'none';

    if (window.myChart) {
        window.myChart.destroy();
        window.myChart = null;
    }
}

async function runBrancher(mode) {
    const listEl = document.getElementById('resultsList');
    const chartEl = document.getElementById('resultChart');
    const mapEl = document.getElementById('resultMap');
    const fullBtn = document.getElementById('toggleFullscreen');

    const params = new URLSearchParams({
        size: document.getElementById('gridSize').value,
        min_sons: document.getElementById('mSons').value,
        min_hex: document.getElementById('mHex').value,
        start: document.getElementById('tStart').value,
        end: document.getElementById('tEnd').value,
        t_window: document.getElementById('tWindow').value,
        min_hex_son: document.getElementById('mHexSon').value,
        min_grandsons: document.getElementById('mGrandsons').value,
    });

    const pSnp = document.getElementById('pSnp').value.trim();
    if (pSnp) params.append('parent_snp', pSnp);
    if (selectedH3Indices.size > 0) params.append('h3_indices', Array.from(selectedH3Indices).join(','));

    if (mode === 'list') {
        mapEl.style.display = 'none';
        fullBtn.style.display = 'none';
        chartEl.style.display = 'none';
        listEl.style.display = 'block';
        listEl.innerHTML = `<li>${BUSY_STATE_TEXT}</li>`;
    } else if (mode === 'chart') {
        listEl.style.display = 'none';
        mapEl.style.display = 'none';
        fullBtn.style.display = 'none';
        chartEl.style.display = 'block';
    } else {
        listEl.style.display = 'none';
        chartEl.style.display = 'none';
        mapEl.style.display = 'block';
        fullBtn.style.display = 'block';
        setTimeout(() => resultMap.invalidateSize(), 100);
    }

    try {
        const response = await fetch(`${CONFIG.API_BASE_URL}${CONFIG.ENDPOINTS.EXPLOSIVE_BRANCHES}?${params}`);
        if (!response.ok) throw new Error(`${SERVER_ERROR_TEXT} (${response.status})`);
        const data = await response.json();

        if (mode === 'list') {
            renderList(data);
        } else if (mode === 'chart') {
            renderChart(data);
        } else {
            updateHeatmap(data);
        }
    } catch (error) {
        listEl.style.display = 'block';
        listEl.innerHTML = `<li style="color: red;">${error.message}</li>`;
    }
}

function renderList(data) {
    const list = document.getElementById('resultsList');
    list.innerHTML = data.length > 0
        ? data.map(item => `
            <li>
                <span><strong>${item.snp}</strong></span>
                <span>🌿 Сыновей: ${item.window_sons} | ⬢ Ячеек: ${item.hex_count}</span>
            </li>`).join('')
        : '<li>Ничего не найдено.</li>';
}

function updateHeatmap(data) {
    resultLayer.clearLayers();
    const minN = parseInt(document.getElementById('minOverlap').value) || 1;
    const counts = {};

    data.forEach(branch => {
        if (branch.centroids) {
            [...new Set(branch.centroids)].forEach(idx => {
                counts[idx] = (counts[idx] || 0) + 1;
            });
        }
    });

    const filteredIndices = Object.keys(counts).filter(idx => counts[idx] >= minN);
    if (filteredIndices.length === 0) return;

    const maxOverlap = Math.max(...filteredIndices.map(idx => counts[idx]));

    filteredIndices.forEach(idx => {
        const val = counts[idx];

        const colorIdx = maxOverlap === minN
            ? 0
            : Math.floor((1 - (val - minN) / (maxOverlap - minN)) * (PALETTE_GROUP.length - 1));

        const hexColor = PALETTE_GROUP[colorIdx];

        L.polygon(h3.cellToBoundary(idx), {
            color: hexColor,
            fillColor: hexColor,
            fillOpacity: 0.7,
            weight: 0.5
        }).bindPopup(`Пересечений веток: ${val}`).addTo(resultLayer);
    });
}

function getSnpJitter(snpName) {
    let hash = 0;
    for (let i = 0; i < snpName.length; i++) {
        hash = snpName.charCodeAt(i) + ((hash << 5) - hash);
    }
    return ((Math.abs(hash) % 100) / 100) * 0.5 - 0.25;
}

function renderChart(data) {
    const ctx = document.getElementById('resultChart').getContext('2d');

    const tStart = parseInt(document.getElementById('tStart').value);
    const tEnd = parseInt(document.getElementById('tEnd').value);
    const showWaves = document.getElementById('showWaves') ? document.getElementById('showWaves').checked : true;

    if (window.myChart) window.myChart.destroy();

    const points = [];
    const pointColors = [];
    const snpPositionsMap = new Map();
    const snpChildrenMap = new Map();

    data.forEach((item, i) => {
        const color = PALETTE_SNPS[i % PALETTE_SNPS.length];
        const jitteredY = item.window_sons + getSnpJitter(item.snp);
        points.push({
            x: item.tmrca,
            y: jitteredY,
            real_y: item.window_sons,
            snp: item.snp,
            parent_snp: item.parent_snp,
            baseColor: color
        });
        snpPositionsMap.set(item.snp, {
            x: item.tmrca,
            y: jitteredY,
            color: color,
            parent_snp: item.parent_snp
        });
        if (item.parent_snp) {
            if (!snpChildrenMap.has(item.parent_snp)) {
                snpChildrenMap.set(item.parent_snp, []);
            }
            snpChildrenMap.get(item.parent_snp).push(item.snp);
        }
    });

    function getFullSubtree(targetSnp) {
        const connectedSnps = new Set();
        if (!targetSnp) return connectedSnps;
        let currentParent = snpPositionsMap.get(targetSnp)?.parent_snp;
        while (currentParent) {
            connectedSnps.add(currentParent);
            currentParent = snpPositionsMap.get(currentParent)?.parent_snp;
        }
        function collectDescendants(snp) {
            connectedSnps.add(snp);
            const children = snpChildrenMap.get(snp) || [];
            children.forEach(child => {
                if (!connectedSnps.has(child)) {
                    collectDescendants(child);
                }
            });
        }
        collectDescendants(targetSnp);
        return connectedSnps;
    }

    const waveLinesPlugin = {
        id: 'waveLines',
        beforeDatasetsDraw(chart) {
            const checkbox = document.getElementById('showWaves');
            if (checkbox && !checkbox.checked) return;
            const { ctx, scales: { x: xScale, y: yScale } } = chart;
            const currentPoints = chart.data.datasets[0].data;
            const activeTree = getFullSubtree(hoveredSnp);
            const hasActiveHighlight = activeTree.size > 0;
            ctx.save();
            currentPoints.forEach((point) => {
                if (point.parent_snp && snpPositionsMap.has(point.parent_snp)) {
                    const parent = snpPositionsMap.get(point.parent_snp);
                    const startX = xScale.getPixelForValue(parent.x);
                    const startY = yScale.getPixelForValue(parent.y);
                    const endX = xScale.getPixelForValue(point.x);
                    const endY = yScale.getPixelForValue(point.y);
                    ctx.beginPath();
                    ctx.moveTo(startX, startY);
                    ctx.lineTo(endX, endY);
                    if (hasActiveHighlight && activeTree.has(point.snp) && activeTree.has(point.parent_snp)) {
                        ctx.lineWidth = 3.0;
                        ctx.strokeStyle = parent.color;
                    } else {
                        ctx.lineWidth = 1.0;
                        ctx.strokeStyle = hasActiveHighlight ? 'rgba(200, 200, 200, 0.15)' : parent.color + '80';
                    }
                    ctx.stroke();
                }
            });
            ctx.restore();
        }
    };

    window.myChart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                data: points,
                backgroundColor: function(context) {
                    const point = context.raw;
                    if (!point) return 'rgba(0,0,0,0.1)';
                    const activeTree = getFullSubtree(hoveredSnp);
                    if (activeTree.size === 0) return point.baseColor;
                    return activeTree.has(point.snp) ? point.baseColor : 'rgba(220, 220, 220, 0.2)';
                },
                pointRadius: function(context) {
                    const point = context.raw;
                    if (!point) return 8;
                    const activeTree = getFullSubtree(hoveredSnp);
                    return (activeTree.size > 0 && activeTree.has(point.snp)) ? 11 : 7;
                },
                pointHoverRadius: 12,
                borderWidth: 1,
                borderColor: 'rgba(0,0,0,0.1)'
            }]
        },
        plugins: [waveLinesPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onHover: (event, activeElements) => {
                if (activeElements && activeElements.length > 0) {
                    const index = activeElements[0].index;
                    const snp = window.myChart.data.datasets[0].data[index].snp;
                    if (hoveredSnp !== snp) {
                        hoveredSnp = snp;
                        window.myChart.update('none');
                    }
                } else {
                    if (hoveredSnp !== null) {
                        hoveredSnp = null;
                        window.myChart.update('none');
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    position: 'bottom',
                    min: tStart,
                    max: tEnd,
                    title: { display: true, text: 'Год (TMRCA)' }
                },
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'Число сыновей' },
                    ticks: { stepSize: 1 }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    position: 'nearest',
                    xAlign: 'center',
                    yAlign: 'top',
                    callbacks: {
                        label: function(context) {
                            const p = context.raw;
                            let label = ` ${p.snp}: ${p.real_y} сыновей (${p.x} г.)`;
                            if (p.parent_snp) {
                                label += ` | Род: ${p.parent_snp}`;
                            }
                            return label;
                        }
                    }
                }
            }
        }
    });
}

