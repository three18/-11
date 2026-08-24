// ============ ИНИЦИАЛИЗАЦИЯ КАРТЫ ============
const defaultCoords = [55.7558, 37.6173];
const map = L.map('map').setView(defaultCoords, 11);

// Слои карты
const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
});
const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '© Esri'
});
const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenTopoMap'
});

osm.addTo(map);
L.control.layers({
    "🗺️ Схема": osm,
    "🛰️ Спутник": satellite,
    "⛰️ Рельеф": topo
}).addTo(map);

function create3DBuildingsLayer() {
    if (typeof OSMBuildings === 'undefined') return null;
    return new OSMBuildings(map).load('https://{s}.data.osmbuildings.org/0.2/59fcc2e8/tile/{z}/{x}/{y}.json');
}

// ============ ХРАНИЛИЩЕ МАРКЕРОВ ============
// Все маркеры хранятся тут: { id, marker, data }
let allMarkers = [];
let allPolygons = [];
let nextId = 1;
let activeDistrictId = '';
let isSatelliteMode = false;
let is3DMode = false;
let buildings3DLayer = null;

function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[char]));
}

function isValidHttpUrl(value) {
    if (!value) return false;
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
    } catch (e) {
        return false;
    }
}

function isValidCoords(coords) {
    return Array.isArray(coords) &&
        coords.length === 2 &&
        coords.every(Number.isFinite) &&
        coords[0] >= -90 && coords[0] <= 90 &&
        coords[1] >= -180 && coords[1] <= 180;
}

function normalizePlaceId(place) {
    const parsedId = Number(place.id);
    if (Number.isSafeInteger(parsedId) && parsedId > 0) {
        place.id = parsedId;
    } else {
        place.id = Date.now() + nextId;
    }
}

function getStoredPlaces() {
    try {
        const places = JSON.parse(localStorage.getItem('userPlaces') || '[]');
        return Array.isArray(places) ? places : [];
    } catch (e) {
        console.warn('userPlaces повреждён, хранилище сброшено');
        localStorage.removeItem('userPlaces');
        return [];
    }
}

function saveStoredPlaces(places) {
    localStorage.setItem('userPlaces', JSON.stringify(places));
}

function isVisibleBySearch(data) {
    const input = document.getElementById('search-input');
    const query = input ? input.value.toLowerCase().trim() : '';
    return !query || String(data.name || '').toLowerCase().includes(query);
}

function isVisibleByFilter(data) {
    return activeFilters.length === categories.length || activeFilters.includes(data.type);
}

function isVisibleByDistrict(data) {
    if (!activeDistrictId) return true;
    const districtId = Number(activeDistrictId);
    return Number(data.id) === districtId || Number(data.parentId) === districtId;
}

function updateMarkerVisibility() {
    allMarkers.forEach(({ marker, data }) => {
        if (isVisibleBySearch(data) && isVisibleByFilter(data) && isVisibleByDistrict(data)) {
            if (!map.hasLayer(marker)) marker.addTo(map);
        } else {
            map.removeLayer(marker);
        }
    });

    allPolygons.forEach(({ polygon, data }) => {
        if (isVisibleBySearch(data) && isVisibleByDistrict(data)) {
            if (!map.hasLayer(polygon)) polygon.addTo(map);
        } else {
            map.removeLayer(polygon);
        }
    });
}

// ============ КАТЕГОРИИ И ФИЛЬТРЫ ============
const categories = [
    { emoji: '🏠', name: 'Дом' },
    { emoji: '🏢', name: 'Работа' },
    { emoji: '🍽️', name: 'Рестораны' },
    { emoji: '☕', name: 'Кафе' },
    { emoji: '🛒', name: 'Магазины' },
    { emoji: '🏥', name: 'Здоровье' },
    { emoji: '🎓', name: 'Образование' },
    { emoji: '🎭', name: 'Развлечения' },
    { emoji: '🌳', name: 'Природа' },
    { emoji: '🚇', name: 'Транспорт' },
    { emoji: '🏨', name: 'Отели' },
    { emoji: '📍', name: 'Другое' }
];

let activeFilters = [];

// ============ СОЗДАНИЕ ИКОНКИ ============
function createIcon(emoji) {
    return L.divIcon({
        html: `<div class="custom-icon">${escapeHTML(emoji || '📍')}</div>`,
        className: '',
        iconSize: [32, 32],
        iconAnchor: [16, 32],
        popupAnchor: [0, -32]
    });
}

// ============ ДОБАВЛЕНИЕ МАРКЕРА ============
function addMarkerToMap(place) {
    normalizePlaceId(place);
    const id = nextId++;
    const icon = createIcon(place.type || '📍');
    const safeName = escapeHTML(place.name || 'Без названия');
    const safeDescription = escapeHTML(place.description || 'Нет описания');
    const safePhoto = isValidHttpUrl(place.photo) ? escapeHTML(place.photo) : '';
    const safeType = escapeHTML(place.type || '📍');
    
    const popupHTML = `
        <div class="popup-content">
            <h3>${safeType} ${safeName}</h3>
            ${safePhoto ? `<img src="${safePhoto}" alt="${safeName}">` : ''}
            <p>${safeDescription}</p>
            <div class="popup-coords">📍 ${place.coords[0].toFixed(4)}, ${place.coords[1].toFixed(4)}</div>
            <button class="btn-delete" onclick="deletePlace(${id})">🗑️ Удалить место</button>
        </div>
    `;
    
    const marker = L.marker(place.coords, { icon })
        .addTo(map)
        .bindPopup(popupHTML);
    
    allMarkers.push({ id, marker, data: place });
    updateMarkerVisibility();
    return id;
}

function addPolygonToMap(place) {
    if (!Array.isArray(place.polygon) || !place.polygon.every(isValidCoords)) return;

    const polygon = L.polygon(place.polygon, {
        color: '#6366f1',
        weight: 2,
        fillColor: '#6366f1',
        fillOpacity: 0.12
    }).addTo(map);

    polygon.bindTooltip(escapeHTML(place.name || 'Район'));
    allPolygons.push({ polygon, data: place });
}

function refreshDistrictFilter() {
    const districtFilter = document.getElementById('district-filter');
    const parentSelect = document.getElementById('inp-parent');
    if (!districtFilter || !parentSelect) return;

    const districts = allMarkers
        .map(({ data }) => data)
        .filter(place => !place.parentId);

    const options = districts.map(place =>
        `<option value="${place.id}">${escapeHTML(place.type || '📍')} ${escapeHTML(place.name || 'Без названия')}</option>`
    ).join('');

    districtFilter.innerHTML = `<option value="">Все районы</option>${options}`;
    districtFilter.value = activeDistrictId;
    parentSelect.innerHTML = `<option value="">— Нет (главная точка / район) —</option>${options}`;
}

// ============ УДАЛЕНИЕ МЕСТА ============
function deletePlace(id) {
    if (!confirm('Удалить это место?')) return;
    
    // Удаляем из карты
    const index = allMarkers.findIndex(m => m.id === id);
    if (index !== -1) {
        const removedPlaceId = allMarkers[index].data.id;
        map.removeLayer(allMarkers[index].marker);
        allMarkers.splice(index, 1);
        allPolygons = allPolygons.filter(({ polygon, data }) => {
            if (data.id !== removedPlaceId) return true;
            map.removeLayer(polygon);
            return false;
        });
        if (activeDistrictId && Number(activeDistrictId) === removedPlaceId) activeDistrictId = '';
    }
    
    // Удаляем из localStorage
    const localPlaces = getStoredPlaces();
    const filtered = localPlaces.filter(p => p._id !== id);
    saveStoredPlaces(filtered);
    
    map.closePopup();
    refreshDistrictFilter();
    updateMarkerVisibility();
    updateSidebar();
    showMessage('Место удалено 🗑️', 'success');
}

// ============ ЗАГРУЗКА ДАННЫХ ============
async function loadPlaces() {
    // Из JSON файла
    try {
        const response = await fetch('places.json');
        if (response.ok) {
            const data = await response.json();
            (data.places || []).forEach(place => {
                addMarkerToMap(place);
                addPolygonToMap(place);
            });
        }
    } catch (e) {
        console.warn('places.json не загружен');
    }
    
    // Из localStorage (с восстановлением ID)
    const localPlaces = getStoredPlaces();
    localPlaces.forEach(place => {
        const id = addMarkerToMap(place);
        place._id = id;
    });
    // Пересохраняем с актуальными ID
    saveStoredPlaces(localPlaces);
    
    refreshDistrictFilter();
    updateMarkerVisibility();
    updateSidebar();
}

// ============ ФОРМА ДОБАВЛЕНИЯ ============
const form = document.getElementById('add-form');
const toast = document.getElementById('toast');

// Режим добавления
let addMode = false;
let tempCoords = null;

document.getElementById('btn-add-mode').addEventListener('click', function() {
    addMode = !addMode;
    this.classList.toggle('active', addMode);
    document.getElementById('hint').style.display = addMode ? 'block' : 'none';
    map.getContainer().style.cursor = addMode ? 'crosshair' : '';
    if (addMode) {
        document.getElementById('modal-overlay').style.display = 'flex';
        tempCoords = null;
        document.getElementById('inp-coords').value = '';
    } else {
        document.getElementById('modal-overlay').style.display = 'none';
    }
});

document.getElementById('btn-close-modal').addEventListener('click', function() {
    addMode = false;
    document.getElementById('btn-add-mode').classList.remove('active');
    document.getElementById('modal-overlay').style.display = 'none';
    document.getElementById('hint').style.display = 'none';
    map.getContainer().style.cursor = '';
});

document.getElementById('modal-overlay').addEventListener('click', function(e) {
    if (e.target === this) {
        document.getElementById('btn-close-modal').click();
    }
});

// Клик по карте для выбора координат
map.on('click', function(e) {
    if (addMode) {
        tempCoords = [e.latlng.lat, e.latlng.lng];
        document.getElementById('inp-coords').value = `${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`;
    }
});

form.addEventListener('submit', function(e) {
    e.preventDefault();
    
    const name = document.getElementById('inp-name').value.trim();
    const categoryPicker = document.querySelector('#category-picker .category-btn.selected');
    const type = categoryPicker ? categoryPicker.dataset.emoji : '📍';
    const coordsRaw = document.getElementById('inp-coords').value.trim();
    const photo = document.getElementById('inp-photo').value.trim();
    const description = document.getElementById('inp-desc').value.trim();
    const parentIdRaw = document.getElementById('inp-parent').value;
    
    let coordsArray;
    if (tempCoords) {
        coordsArray = tempCoords;
    } else {
        coordsArray = coordsRaw.split(',').map(c => parseFloat(c.trim()));
    }
    
    if (!isValidCoords(coordsArray)) {
        showMessage('Ошибка: выберите точку на карте или введите координаты', 'error');
        return;
    }
    
    const newPlace = {
        id: Date.now(),
        name,
        type,
        coords: coordsArray,
        parentId: parentIdRaw ? Number(parentIdRaw) : null,
        photo,
        description,
        polygon: null
    };
    const id = addMarkerToMap(newPlace);
    newPlace._id = id;
    
    // Сохраняем в localStorage
    const localPlaces = getStoredPlaces();
    localPlaces.push(newPlace);
    saveStoredPlaces(localPlaces);
    
    map.setView(newPlace.coords, 14);
    form.reset();
    document.getElementById('btn-close-modal').click();
    refreshDistrictFilter();
    updateSidebar();
    showMessage('Место добавлено! ✅', 'success');
});

function showMessage(text, type = 'info') {
    toast.textContent = text;
    toast.className = `toast ${type} show`;
    setTimeout(() => { 
        toast.className = 'toast'; 
        toast.textContent = '';
    }, 3000);
}

// ============ ПОИСК ============
document.getElementById('search-input').addEventListener('input', updateMarkerVisibility);

// ============ ЭКСПОРТ В JSON ============
document.getElementById('btn-export').addEventListener('click', function() {
    const places = allMarkers.map(m => ({
        name: m.data.name,
        type: m.data.type,
        coords: m.data.coords,
        photo: m.data.photo,
        description: m.data.description
    }));
    
    const blob = new Blob([JSON.stringify({ places }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-places-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showMessage(`Экспортировано мест: ${places.length} 📥`, 'success');
});

// ============ ИМПОРТ ИЗ ФАЙЛА ============
document.getElementById('btn-import').addEventListener('click', function() {
    document.getElementById('import-file').click();
});

document.getElementById('import-file').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            const data = JSON.parse(event.target.result);
            const places = data.places || [];
            let count = 0;
            
            places.forEach(place => {
                if (place.name && isValidCoords(place.coords)) {
                    const id = addMarkerToMap(place);
                    addPolygonToMap(place);
                    place._id = id;
                    
                    const localPlaces = getStoredPlaces();
                    localPlaces.push(place);
                    saveStoredPlaces(localPlaces);
                    count++;
                }
            });
            
            refreshDistrictFilter();
            updateSidebar();
            showMessage(`Импортировано мест: ${count} 📤`, 'success');
        } catch (err) {
            showMessage('Ошибка: неверный формат файла', 'error');
        }
    };
    reader.readAsText(file);
    e.target.value = ''; // сброс для повторной загрузки того же файла
});

// ============ ЛИНЕЙКА (ИЗМЕРЕНИЕ РАССТОЯНИЙ) ============
let rulerMode = false;
let rulerPoints = [];
let rulerLine = null;
let rulerMarkers = [];
let rulerInfo = null;

// Создаём блок с информацией о расстоянии
rulerInfo = document.createElement('div');
rulerInfo.className = 'ruler-info';
document.body.appendChild(rulerInfo);

const btnRuler = document.getElementById('btn-ruler');
btnRuler.addEventListener('click', function() {
    rulerMode = !rulerMode;
    btnRuler.classList.toggle('active', rulerMode);
    
    if (rulerMode) {
        rulerInfo.classList.add('active');
        rulerInfo.textContent = '📏 Кликните на первую точку на карте';
        map.getContainer().style.cursor = 'crosshair';
    } else {
        clearRuler();
    }
});

map.on('click', function(e) {
    if (!rulerMode) return;
    
    rulerPoints.push(e.latlng);
    const m = L.circleMarker(e.latlng, {
        radius: 6, color: '#f44336', fillColor: '#f44336', fillOpacity: 1
    }).addTo(map);
    rulerMarkers.push(m);
    
    if (rulerPoints.length === 1) {
        rulerInfo.textContent = '📏 Кликните на вторую точку';
    } else if (rulerPoints.length === 2) {
        // Рисуем линию
        rulerLine = L.polyline(rulerPoints, { color: '#f44336', weight: 3, dashArray: '5,10' }).addTo(map);
        
        // Считаем расстояние (формула Haversine)
        const distance = getDistance(rulerPoints[0], rulerPoints[1]);
        let text;
        if (distance < 1000) {
            text = `📏 Расстояние: ${distance.toFixed(0)} м`;
        } else {
            text = `📏 Расстояние: ${(distance/1000).toFixed(2)} км`;
        }
        rulerInfo.textContent = text + ' (клик — сброс)';
        
        // Третий клик — сброс
        rulerPoints = [];
        setTimeout(() => {
            const resetHandler = function() {
                clearRuler();
                map.off('click', resetHandler);
            };
            if (rulerMode) map.once('click', resetHandler);
        }, 100);
    }
});

function clearRuler() {
    rulerMode = false;
    btnRuler.classList.remove('active');
    rulerInfo.classList.remove('active');
    rulerInfo.textContent = '';
    map.getContainer().style.cursor = '';
    
    rulerMarkers.forEach(m => map.removeLayer(m));
    if (rulerLine) map.removeLayer(rulerLine);
    
    rulerPoints = [];
    rulerMarkers = [];
    rulerLine = null;
}

// Формула Haversine для расчёта расстояния между двумя точками
function getDistance(p1, p2) {
    const R = 6371000; // радиус Земли в метрах
    const toRad = deg => deg * Math.PI / 180;
    const dLat = toRad(p2.lat - p1.lat);
    const dLng = toRad(p2.lng - p1.lng);
    const a = Math.sin(dLat/2)**2 + 
              Math.cos(toRad(p1.lat)) * Math.cos(toRad(p2.lat)) * 
              Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ============ ИНИЦИАЛИЗАЦИЯ КАТЕГОРИЙ И ФИЛЬТРОВ ============
function initCategoryPicker() {
    const picker = document.getElementById('category-picker');
    if (!picker) return;
    
    picker.innerHTML = categories.map(cat => `
        <button type="button" class="category-btn" data-emoji="${cat.emoji}" data-name="${cat.name}">
            ${cat.emoji} ${cat.name}
        </button>
    `).join('');
    
    // Выбор категории
    picker.querySelectorAll('.category-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            picker.querySelectorAll('.category-btn').forEach(b => b.classList.remove('selected'));
            this.classList.add('selected');
        });
    });
    
    // Выбрать первую категорию по умолчанию
    const firstBtn = picker.querySelector('.category-btn');
    if (firstBtn) firstBtn.classList.add('selected');
}

function initFilters() {
    const filtersContainer = document.getElementById('filters');
    if (!filtersContainer) return;
    
    filtersContainer.innerHTML = categories.map(cat => `
        <label class="filter-item">
            <input type="checkbox" value="${cat.emoji}" checked>
            ${cat.emoji}
        </label>
    `).join('');
    
    // Обработчик фильтров
    filtersContainer.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            applyFilters();
        });
    });
    applyFilters();
}

function applyFilters() {
    const filtersContainer = document.getElementById('filters');
    if (!filtersContainer) return;
    
    activeFilters = [];
    filtersContainer.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
        activeFilters.push(cb.value);
    });
    
    updateMarkerVisibility();
}

function initDistrictFilter() {
    const districtFilter = document.getElementById('district-filter');
    if (!districtFilter) return;

    districtFilter.addEventListener('change', function() {
        activeDistrictId = this.value;
        updateMarkerVisibility();
    });
}

function initMapViewButtons() {
    const btnSatellite = document.getElementById('btn-satellite');
    const btn3D = document.getElementById('btn-3d');

    btnSatellite?.addEventListener('click', function() {
        isSatelliteMode = !isSatelliteMode;
        if (isSatelliteMode) {
            map.removeLayer(osm);
            map.removeLayer(topo);
            satellite.addTo(map);
        } else {
            map.removeLayer(satellite);
            osm.addTo(map);
        }
        this.classList.toggle('active', isSatelliteMode);
    });

    btn3D?.addEventListener('click', function() {
        is3DMode = !is3DMode;
        document.body.classList.toggle('map-3d', is3DMode);

        if (is3DMode) {
            buildings3DLayer = buildings3DLayer || create3DBuildingsLayer();
            if (!buildings3DLayer) {
                showMessage('3D слой не загрузился. Проверь интернет-соединение.', 'error');
                is3DMode = false;
                document.body.classList.remove('map-3d');
            }
        } else if (buildings3DLayer?.remove) {
            buildings3DLayer.remove();
            buildings3DLayer = null;
        }

        this.classList.toggle('active', is3DMode);
        setTimeout(() => map.invalidateSize(), 250);
    });
}

function initMovableToolbar() {
    const toolbar = document.querySelector('.top-bar');
    const btnLayout = document.getElementById('btn-layout');
    if (!toolbar || !btnLayout) return;

    const savedPosition = getToolbarPosition();
    if (savedPosition) {
        applyToolbarPosition(toolbar, savedPosition.left, savedPosition.top);
    }

    let isLayoutMode = false;
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    btnLayout.addEventListener('click', function() {
        isLayoutMode = !isLayoutMode;
        toolbar.classList.toggle('layout-mode', isLayoutMode);
        this.classList.toggle('active', isLayoutMode);
        showMessage(isLayoutMode
            ? 'Режим перемещения: перетащите панель за любое пустое место'
            : 'Расположение панели сохранено', 'info');
    });

    toolbar.addEventListener('pointerdown', function(e) {
        if (!isLayoutMode || e.target.closest('button, input, select, label')) return;
        isDragging = true;
        const rect = toolbar.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;
        toolbar.setPointerCapture(e.pointerId);
        toolbar.classList.add('dragging');
    });

    toolbar.addEventListener('pointermove', function(e) {
        if (!isDragging) return;
        const left = clamp(e.clientX - dragOffsetX, 8, window.innerWidth - toolbar.offsetWidth - 8);
        const top = clamp(e.clientY - dragOffsetY, 8, window.innerHeight - toolbar.offsetHeight - 8);
        applyToolbarPosition(toolbar, left, top);
    });

    toolbar.addEventListener('pointerup', function(e) {
        if (!isDragging) return;
        isDragging = false;
        toolbar.releasePointerCapture(e.pointerId);
        toolbar.classList.remove('dragging');
        const rect = toolbar.getBoundingClientRect();
        saveToolbarPosition(rect.left, rect.top);
    });

    window.addEventListener('resize', function() {
        const rect = toolbar.getBoundingClientRect();
        applyToolbarPosition(
            toolbar,
            clamp(rect.left, 8, window.innerWidth - toolbar.offsetWidth - 8),
            clamp(rect.top, 8, window.innerHeight - toolbar.offsetHeight - 8)
        );
    });
}

function getToolbarPosition() {
    try {
        const value = JSON.parse(localStorage.getItem('toolbarPosition') || 'null');
        if (!value || !Number.isFinite(value.left) || !Number.isFinite(value.top)) return null;
        return value;
    } catch (e) {
        localStorage.removeItem('toolbarPosition');
        return null;
    }
}

function saveToolbarPosition(left, top) {
    localStorage.setItem('toolbarPosition', JSON.stringify({ left, top }));
}

function applyToolbarPosition(toolbar, left, top) {
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${top}px`;
    toolbar.style.transform = 'none';
}

function clamp(value, min, max) {
    return Math.min(Math.max(value, min), Math.max(min, max));
}

// ============ БОКОВАЯ ПАНЕЛЬ ============
function renderSidebar() {
    const placesList = document.getElementById('places-list');
    if (!placesList) return;
    
    if (allMarkers.length === 0) {
        placesList.innerHTML = '<p class="empty-message">Нет сохранённых мест</p>';
        return;
    }
    
    placesList.innerHTML = allMarkers.map(({ id, data }) => `
        <div class="place-item" data-id="${id}">
            <div class="place-icon">${escapeHTML(data.type || '📍')}</div>
            <div class="place-info">
                <div class="place-name">${escapeHTML(data.name || 'Без названия')}</div>
                <div class="place-coords-small">${data.coords[0].toFixed(4)}, ${data.coords[1].toFixed(4)}</div>
            </div>
            <button class="btn-delete-small" onclick="deletePlace(${id})">✕</button>
        </div>
    `).join('');
    
    // Клик по элементу списка
    placesList.querySelectorAll('.place-item').forEach(item => {
        item.addEventListener('click', function(e) {
            if (e.target.classList.contains('btn-delete-small')) return;
            const id = parseInt(this.dataset.id);
            const markerData = allMarkers.find(m => m.id === id);
            if (markerData) {
                map.setView(markerData.data.coords, 14);
                markerData.marker.openPopup();
            }
        });
    });
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const openBtn = document.getElementById('btn-open-sidebar');
    if (sidebar && openBtn) {
        sidebar.classList.toggle('open');
        openBtn.style.display = sidebar.classList.contains('open') ? 'none' : 'block';
    }
}

document.getElementById('btn-toggle-sidebar')?.addEventListener('click', toggleSidebar);
document.getElementById('btn-open-sidebar')?.addEventListener('click', toggleSidebar);

// ============ ОБНОВЛЕНИЕ СПИСКА МЕСТ ПРИ ИЗМЕНЕНИЯХ ============
function updateSidebar() {
    renderSidebar();
}

// ============ СТАРТ ============

// Регистрация Service Worker для PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(() => console.log('Service Worker зарегистрирован'))
            .catch(err => console.log('Ошибка SW:', err));
    });
}

// Инициализация категорий и фильтров
initCategoryPicker();
initFilters();
initDistrictFilter();
initMapViewButtons();
initMovableToolbar();

loadPlaces().then(() => {
    updateSidebar();
});