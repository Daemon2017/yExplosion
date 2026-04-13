document.addEventListener('DOMContentLoaded', () => {
    initMaps();
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
            if (selectedH3Indices.size >= 20) return;
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
}

async function runBrancher(mode) {
    const listEl = document.getElementById('resultsList');
    const mapEl = document.getElementById('resultMap');
    const fullBtn = document.getElementById('toggleFullscreen');

    const params = new URLSearchParams({
        size: document.getElementById('gridSize').value,
        min_sons: document.getElementById('mSons').value,
        min_hex: document.getElementById('mHex').value,
        start: document.getElementById('tStart').value,
        end: document.getElementById('tEnd').value,
        t_window: document.getElementById('tWindow').value,
        min_hex_son: document.getElementById('mHexSon').value
    });

    const pSnp = document.getElementById('pSnp').value.trim();
    if (pSnp) params.append('parent_snp', pSnp);
    if (selectedH3Indices.size > 0) params.append('h3_indices', Array.from(selectedH3Indices).join(','));

    if (mode === 'list') {
        mapEl.style.display = 'none';
        fullBtn.style.display = 'none';
        listEl.style.display = 'block';
        listEl.innerHTML = `<li>${BUSY_STATE_TEXT}</li>`;
    } else {
        listEl.style.display = 'none';
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
