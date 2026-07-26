document.addEventListener('DOMContentLoaded', function () {
    const sidebarLinks = document.querySelectorAll('.sidebar-menu li a');
    const sections = document.querySelectorAll('section');
    const inputSection = document.getElementById('input');
    const sidebar = document.querySelector('.sidebar');
    const menuToggle = document.getElementById('menu-toggle');

    function checkScreenSize() {
        if (window.innerWidth > 768) {
            sidebar.classList.add('active');
        } else {
            sidebar.classList.remove('active');
        }
    }

    checkScreenSize();

    menuToggle.addEventListener('click', function () {
        sidebar.classList.toggle('active');
    });

    function setActiveNav(targetId) {
        sidebarLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === '#' + targetId) {
                link.classList.add('active');
            }
        });
    }

    sidebarLinks.forEach(link => {
        link.addEventListener('click', function (event) {
            event.preventDefault();
            const targetId = this.getAttribute('href').substring(1);

            sections.forEach(section => {
                section.classList.remove('active');
                section.style.display = 'none';
            });

            const targetSection = document.getElementById(targetId);
            if (targetSection) {
                targetSection.classList.add('active');
                targetSection.style.display = 'block';
            }

            setActiveNav(targetId);

            if (window.innerWidth <= 768) {
                sidebar.classList.remove('active');
            }
        });
    });

    inputSection.classList.add('active');
    inputSection.style.display = 'block';
    setActiveNav('input');

    window.addEventListener('resize', checkScreenSize);
});

let modules = JSON.parse(localStorage.getItem('modules')) || [];

function showToast(message, type) {
    const existing = document.querySelector('.toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.innerHTML = `<i class='bx ${type === 'success' ? 'bx-check-circle' : 'bx-error'}'></i> ${message}`;
    document.body.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('toast--visible'));
    setTimeout(() => {
        toast.classList.remove('toast--visible');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

function addModule() {
    const name = document.getElementById('module-name').value.trim();
    const year = document.getElementById('year').value.trim();
    const part = document.getElementById('part').value.trim();
    const semester = document.getElementById('semester').value.trim();
    const mark = document.getElementById('mark').value.trim();
    const grade = document.getElementById('grade').value.trim();

    if (!name || !year || !part || !semester || !mark || !grade) {
        showToast("Please fill in all fields.", "error");
        return;
    }

    const semesterNumber = parseInt(semester);
    const markNumber = parseFloat(mark);

    if (isNaN(semesterNumber) || isNaN(markNumber)) {
        showToast("Semester and Mark must be valid numbers.", "error");
        return;
    }

    if (markNumber < 0 || markNumber > 100) {
        showToast("Mark must be between 0 and 100.", "error");
        return;
    }

    const module = { name, year, part, semester: semesterNumber, mark: markNumber, grade };

    modules.push(module);
    localStorage.setItem('modules', JSON.stringify(modules));
    displayModules();
    updateStatistics();
    document.getElementById('module-form').reset();
    showToast("Module added successfully!", "success");
}

document.getElementById('add-module-btn').addEventListener('click', addModule);

function getGradeBadge(grade) {
    const map = {
        '1':   { label: '1st',   cls: 'badge--distinction' },
        '2.1': { label: '2:1',   cls: 'badge--upper' },
        '2.2': { label: '2:2',   cls: 'badge--lower' },
        'P':   { label: 'Pass',  cls: 'badge--pass' },
        'F':   { label: 'Fail',  cls: 'badge--fail' }
    };
    const info = map[grade] || { label: grade, cls: 'badge--default' };
    return `<span class="badge ${info.cls}">${info.label}</span>`;
}

function displayModules() {
    modules = JSON.parse(localStorage.getItem('modules') || '[]');
    const moduleTableBody = document.getElementById('module-table-body');
    moduleTableBody.innerHTML = modules.map((module, index) => `
        <tr>
            <td data-label="Course Name" class="td-name">${module.name}</td>
            <td data-label="Academic Year">${module.year}</td>
            <td data-label="Part">${module.part}</td>
            <td data-label="Semester">${module.semester}</td>
            <td data-label="Mark" class="td-mark">${module.mark}</td>
            <td data-label="Classification">${getGradeBadge(module.grade)}</td>
            <td data-label="Actions" class="td-actions">
                <button class="btn-icon-sm btn-icon-sm--edit" onclick="editModule(${index})" title="Edit"><i class='bx bx-edit-alt'></i></button>
                <button class="btn-icon-sm btn-icon-sm--delete" onclick="deleteModule(${index})" title="Delete"><i class='bx bx-trash'></i></button>
            </td>
        </tr>
    `).join('');
}

displayModules();

function editModule(index) {
    const module = modules[index];
    const modal = document.getElementById('edit-modal');
    const form = document.getElementById('edit-form');

    document.getElementById('edit-name').value = module.name;
    document.getElementById('edit-year').value = module.year;
    document.getElementById('edit-part').value = module.part;
    document.getElementById('edit-semester').value = module.semester;
    document.getElementById('edit-mark').value = module.mark;
    document.getElementById('edit-grade').value = module.grade;

    modal.classList.add('open');

    form.onsubmit = function (e) {
        e.preventDefault();
        const newName = document.getElementById('edit-name').value.trim();
        const newYear = document.getElementById('edit-year').value.trim();
        const newPart = document.getElementById('edit-part').value.trim();
        const newSemester = document.getElementById('edit-semester').value.trim();
        const newMark = document.getElementById('edit-mark').value.trim();
        const newGrade = document.getElementById('edit-grade').value.trim();

        if (!newName || !newYear || !newPart || !newSemester || !newMark || !newGrade) {
            showToast("Please fill in all fields.", "error");
            return;
        }

        modules[index] = { name: newName, year: newYear, part: newPart, semester: parseInt(newSemester), mark: parseFloat(newMark), grade: newGrade };
        localStorage.setItem('modules', JSON.stringify(modules));
        displayModules();
        updateStatistics();
        modal.classList.remove('open');
        showToast("Module updated successfully!", "success");
    };
}

document.getElementById('edit-modal-close').addEventListener('click', function () {
    document.getElementById('edit-modal').classList.remove('open');
});

document.getElementById('edit-modal-cancel').addEventListener('click', function () {
    document.getElementById('edit-modal').classList.remove('open');
});

let pendingDeleteIndex = null;

function deleteModule(index) {
    pendingDeleteIndex = index;
    const module = modules[index];
    document.getElementById('confirm-message').textContent = `Are you sure you want to delete "${module.name}"?`;
    document.getElementById('confirm-modal').classList.add('open');
}

function deleteAllModules() {
    if (modules.length === 0) {
        showToast('No modules to delete.', 'error');
        return;
    }
    pendingDeleteIndex = 'all';
    document.getElementById('confirm-message').textContent = `Are you sure you want to delete ALL ${modules.length} module(s)? This cannot be undone.`;
    document.getElementById('confirm-modal').classList.add('open');
}

document.getElementById('confirm-yes').addEventListener('click', function () {
    if (pendingDeleteIndex === 'all') {
        modules = [];
        localStorage.setItem('modules', JSON.stringify(modules));
        displayModules();
        updateStatistics();
        showToast('All modules deleted.', 'success');
    } else if (pendingDeleteIndex !== null) {
        modules.splice(pendingDeleteIndex, 1);
        localStorage.setItem('modules', JSON.stringify(modules));
        displayModules();
        updateStatistics();
        showToast("Module deleted.", "success");
    }
    pendingDeleteIndex = null;
    document.getElementById('confirm-modal').classList.remove('open');
});

document.getElementById('confirm-no').addEventListener('click', function () {
    pendingDeleteIndex = null;
    document.getElementById('confirm-modal').classList.remove('open');
});

const CHART_FONT = { family: "'Inter', sans-serif" };

function isDarkMode() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
}

function chartColors() {
    const dark = isDarkMode();
    return {
        bar: dark ? '#5B9EF5' : '#14171A',
        grid: dark ? 'rgba(255,255,255,0.06)' : 'rgba(226, 229, 234, 0.6)',
        tick: dark ? 'rgba(255,255,255,0.4)' : '#6B7280',
        tooltip: dark ? '#2A2D31' : '#14171A',
        label: dark ? '#E2E5EA' : '#14171A',
        doughnutBorder: dark ? '#1A1D21' : '#F7F9FA',
        legend: dark ? 'rgba(255,255,255,0.5)' : '#4B5563',
    };
}

function renderGraph() {
    const partData = {};

    modules.forEach(module => {
        const key = `P${module.part} Sem ${module.semester}`;
        if (!partData[key]) {
            partData[key] = { total: 0, count: 0, part: module.part };
        }
        partData[key].total += module.mark;
        partData[key].count += 1;
    });

    const sortedKeys = Object.keys(partData).sort((a, b) => {
        const pa = partData[a].part, pb = partData[b].part;
        if (pa !== pb) return pa - pb;
        const sa = parseInt(a.split('Sem ')[1]);
        const sb = parseInt(b.split('Sem ')[1]);
        return sa - sb;
    });

    const labels = sortedKeys;
    const averages = sortedKeys.map(k => +(partData[k].total / partData[k].count).toFixed(1));

    const SEM_COLORS = [chartColors().bar];
    const colors = sortedKeys.map((_, i) => SEM_COLORS[i % SEM_COLORS.length]);
    const cc = chartColors();

    const ctx = document.getElementById('semesterGraph');
    if (!ctx) return;
    const existingChart = Chart.getChart(ctx);
    if (existingChart) existingChart.destroy();

    new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Average Marks',
                data: averages,
                backgroundColor: colors.map(c => c + 'CC'),
                hoverBackgroundColor: colors,
                borderRadius: 6,
                borderSkipped: false,
                barPercentage: 0.6,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    max: 100,
                    grid: { color: cc.grid, drawBorder: false },
                    ticks: { font: CHART_FONT, color: cc.tick, padding: 8 }
                },
                x: {
                    grid: { display: false },
                    ticks: { font: CHART_FONT, color: cc.tick, padding: 8, maxRotation: 45 }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: { enabled: true, backgroundColor: cc.tooltip, titleFont: CHART_FONT, bodyFont: CHART_FONT, cornerRadius: 8, padding: 12 },
                datalabels: {
                    anchor: 'end',
                    align: 'top',
                    formatter: (value) => value,
                    color: cc.label,
                    font: { family: "'Space Grotesk', sans-serif", weight: '600', size: 12 }
                }
            }
        },
        plugins: [ChartDataLabels]
    });
}

document.addEventListener('DOMContentLoaded', function () {
    updateStatistics();
});

function updateStatistics() {
    const statsData = {};
    let totalMarks = 0, totalCourses = 0;

    modules.forEach(module => {
        const key = `Part ${module.part} - Sem ${module.semester}`;

        if (!statsData[key]) {
            statsData[key] = { distinctions: 0, twos_1: 0, twos_2: 0, passes: 0 };
        }

        if (module.grade === '1') statsData[key].distinctions++;
        if (module.grade === '2.1') statsData[key].twos_1++;
        if (module.grade === '2.2') statsData[key].twos_2++;
        if (module.grade === 'P') statsData[key].passes++;

        totalMarks += module.mark;
        totalCourses++;
    });

    const overallAverage = totalCourses > 0 ? (totalMarks / totalCourses).toFixed(1) : "0";

    document.getElementById('total-marks').textContent = totalMarks;
    document.getElementById('average').textContent = overallAverage;
    document.getElementById('total-modules').textContent = totalCourses;

    renderGraph();
    renderPieChart();
    updateAchievements();
}

function renderPieChart() {
    const classificationData = {
        distinctions: 0,
        twos_1: 0,
        twos_2: 0,
        passes: 0
    };

    modules.forEach(module => {
        if (module.grade === '1') classificationData.distinctions++;
        if (module.grade === '2.1') classificationData.twos_1++;
        if (module.grade === '2.2') classificationData.twos_2++;
        if (module.grade === 'P') classificationData.passes++;
    });

    const ctx = document.getElementById('classificationPieChart');
    if (!ctx) return;
    const existingPieChart = Chart.getChart(ctx);
    if (existingPieChart) {
        existingPieChart.destroy();
    }

    const cc = chartColors();
    new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['1st', '2:1', '2:2', 'Pass'],
            datasets: [{
                data: Object.values(classificationData),
                backgroundColor: ['#22A64C', '#1D6FE0', '#F0A83D', '#DC2626'],
                borderColor: cc.doughnutBorder,
                borderWidth: 3,
                hoverBorderColor: cc.doughnutBorder,
                hoverOffset: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { font: CHART_FONT, color: cc.legend, padding: 16, usePointStyle: true, pointStyleWidth: 10 }
                },
                tooltip: { enabled: true, backgroundColor: cc.tooltip, titleFont: CHART_FONT, bodyFont: CHART_FONT, cornerRadius: 8, padding: 12 },
                datalabels: {
                    formatter: (value) => value,
                    color: '#fff',
                    font: { family: "'Space Grotesk', sans-serif", weight: '600', size: 13 }
                }
            }
        },
        plugins: [ChartDataLabels]
    });
}
