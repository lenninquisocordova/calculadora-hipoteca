// Variable global para almacenar el último cronograma generado (para exportación)
let currentSchedule = [];
let currentSummary = {};

document.addEventListener('DOMContentLoaded', () => {
  const calcBtn = document.getElementById('calcBtn');
  const exportExcelBtn = document.getElementById('exportExcelBtn');
  const doubleCheck = document.getElementById('doublePayments');
  const doubleContainer = document.getElementById('doublePaymentContainer');
  const enablePrepayment = document.getElementById('enablePrepayment');
  const prepaymentOptions = document.getElementById('prepaymentOptions');

  // Alternar visibilidad de cuota doble
  doubleCheck.addEventListener('change', () => {
    doubleContainer.style.display = doubleCheck.checked ? 'flex' : 'none';
  });

  // Alternar visibilidad de opciones de prepago
  enablePrepayment.addEventListener('change', () => {
    if (enablePrepayment.checked) {
      prepaymentOptions.classList.remove('hidden');
    } else {
      prepaymentOptions.classList.add('hidden');
    }
  });

  calcBtn.addEventListener('click', calculateMortgage);
  exportExcelBtn.addEventListener('click', exportToExcel);

  // Ejecución inicial
  calculateMortgage();
});

function calculateMortgage() {
  // 1. Obtener entradas
  const currency = document.getElementById('currency').value;
  const amount = parseFloat(document.getElementById('amount').value);
  const tea = parseFloat(document.getElementById('tea').value);
  const years = parseInt(document.getElementById('years').value);
  const desgravamenRate = parseFloat(document.getElementById('desgravamen').value) / 100; // % mensual
  const propInsuranceRate = parseFloat(document.getElementById('propertyInsurance').value) / 100; // % mensual
  const hasDoublePayments = document.getElementById('doublePayments').checked;

  const hasPrepayment = document.getElementById('enablePrepayment').checked;
  const prepayMonth = parseInt(document.getElementById('prepayMonth').value);
  const prepayAmount = parseFloat(document.getElementById('prepayAmount').value);
  const prepayType = document.getElementById('prepayType').value; // 'term' o 'quota'

  if (isNaN(amount) || isNaN(tea) || isNaN(years) || amount <= 0 || tea <= 0 || years <= 0) {
    alert('Por favor, ingresa datos válidos para el crédito.');
    return;
  }

  const totalMonthsOriginal = years * 12;

  // 2. Convertir TEA a TEM (Tasa Efectiva Mensual)
  const tem = Math.pow(1 + tea / 100, 1 / 12) - 1;

  // 3. Función auxiliar para calcular la cuota base R dado un saldo y un número de meses
  function computeBasePayment(pBalance, pMonths, startMonthIndex = 1) {
    let pvFactorSum = 0;
    for (let k = 1; k <= pMonths; k++) {
      const actualMonthIndex = startMonthIndex + k - 1;
      const isDouble = hasDoublePayments && isJulOrDec(actualMonthIndex);
      const weight = isDouble ? 2 : 1;
      pvFactorSum += weight / Math.pow(1 + tem, k);
    }
    return pBalance / pvFactorSum;
  }

  // Cuota inicial base sin prepagos
  let basePayment = computeBasePayment(amount, totalMonthsOriginal, 1);
  const initialDoublePayment = hasDoublePayments ? basePayment * 2 : basePayment;

  // 4. Bucle del cronograma
  let balance = amount;
  let totalInterest = 0;
  let totalDesgravamen = 0;
  let totalPropInsurance = 0;
  let totalPaid = 0;

  const monthlyPropInsurance = amount * propInsuranceRate; // Seguro de inmueble fijo sobre valor inicial
  currentSchedule = [];

  let k = 1;
  let maxMonths = totalMonthsOriginal;

  while (k <= maxMonths && balance > 0.01) {
    const doubleMonthFlag = hasDoublePayments && isJulOrDec(k);

    // Si hubo prepago previo y se eligió 'quota' (Reducir Cuota), la cuota base cambió
    const currentBasePayment = basePayment;
    const currentQuota = doubleMonthFlag ? currentBasePayment * 2 : currentBasePayment;

    const interest = balance * tem;
    const desgravamen = balance * desgravamenRate;
    const propInsurance = monthlyPropInsurance;

    let amortization = currentQuota - interest;
    let extraPrepayment = 0;

    // Verificar si aplica Prepago en este mes
    if (hasPrepayment && k === prepayMonth && prepayAmount > 0) {
      extraPrepayment = Math.min(prepayAmount, balance - amortization);
    }

    // Ajuste en la última cuota si supera el saldo
    if (amortization + extraPrepayment >= balance) {
      amortization = balance - extraPrepayment;
      if (amortization < 0) {
        extraPrepayment = balance;
        amortization = 0;
      }
    }

    const totalMonthPayment = amortization + interest + desgravamen + propInsurance + extraPrepayment;

    balance = balance - amortization - extraPrepayment;
    if (balance < 0) balance = 0;

    totalInterest += interest;
    totalDesgravamen += desgravamen;
    totalPropInsurance += propInsurance;
    totalPaid += totalMonthPayment;

    currentSchedule.push({
      monthNum: k,
      monthLabel: getMonthName(k),
      basePayment: currentQuota,
      interest: interest,
      amortization: amortization,
      desgravamen: desgravamen,
      propInsurance: propInsurance,
      prepayment: extraPrepayment,
      totalPayment: totalMonthPayment,
      balance: balance,
      isDouble: doubleMonthFlag,
      isPrepay: extraPrepayment > 0
    });

    // Si se aplicó prepago este mes y se eligió REDUCIR CUOTA
    if (hasPrepayment && k === prepayMonth && prepayType === 'quota' && balance > 0) {
      const remainingMonths = totalMonthsOriginal - k;
      if (remainingMonths > 0) {
        basePayment = computeBasePayment(balance, remainingMonths, k + 1);
      }
    }

    // Incrementar mes
    k++;

    // Si no hay prepago o se redujo la cuota, mantenemos el límite original de meses.
    // Si se redujo plazo, la condición balance > 0.01 cortará el bucle cuando llegue a 0.
    if (k > 600) break; // Límite de seguridad
  }

  // 5. Guardar resumen global
  currentSummary = {
    currency,
    initialAmount: amount,
    tea,
    years,
    basePayment: initialDoublePayment / (hasDoublePayments ? 2 : 1),
    doublePayment: initialDoublePayment,
    totalInterest,
    totalInsurance: totalDesgravamen + totalPropInsurance,
    totalPaid,
    totalMonths: currentSchedule.length
  };

  // 6. Actualizar vista HTML
  renderResults();
}

function renderResults() {
  const { currency, basePayment, doublePayment, totalInterest, totalInsurance, totalPaid } = currentSummary;

  document.getElementById('regularPayment').innerText = formatCurrency(basePayment, currency);
  document.getElementById('doublePayment').innerText = formatCurrency(doublePayment, currency);
  document.getElementById('totalInterest').innerText = formatCurrency(totalInterest, currency);
  document.getElementById('totalInsurance').innerText = formatCurrency(totalInsurance, currency);
  document.getElementById('totalPaid').innerText = formatCurrency(totalPaid, currency);

  // Renderizar Tabla
  const scheduleBody = document.getElementById('scheduleBody');
  scheduleBody.innerHTML = '';

  currentSchedule.forEach(row => {
    const tr = document.createElement('tr');
    if (row.isDouble) tr.classList.add('is-double-month');
    if (row.isPrepay) tr.classList.add('is-prepay-month');

    tr.innerHTML = `
      <td>${row.monthNum}</td>
      <td>${row.monthLabel}</td>
      <td>${formatCurrency(row.basePayment, currency)}</td>
      <td>${formatCurrency(row.interest, currency)}</td>
      <td>${formatCurrency(row.amortization, currency)}</td>
      <td>${formatCurrency(row.desgravamen, currency)}</td>
      <td>${formatCurrency(row.propInsurance, currency)}</td>
      <td style="color:#d97706; font-weight:bold;">${row.prepayment > 0 ? formatCurrency(row.prepayment, currency) : '-'}</td>
      <td style="font-weight:bold;">${formatCurrency(row.totalPayment, currency)}</td>
      <td>${formatCurrency(row.balance, currency)}</td>
    `;
    scheduleBody.appendChild(tr);
  });
}

// Exportar datos a hoja de cálculo Excel
function exportToExcel() {
  if (!currentSchedule || currentSchedule.length === 0) {
    alert('No hay cronograma para exportar.');
    return;
  }

  const { currency, initialAmount, tea, years, totalInterest, totalInsurance, totalPaid } = currentSummary;

  // 1. Hoja de Resumen
  const summaryData = [
    ["REPORTE DE SIMULACIÓN HIPOTECARIA"],
    [""],
    ["Monto del Préstamo", `${currency} ${initialAmount.toFixed(2)}`],
    ["Tasa Efectiva Anual (TEA)", `${tea}%`],
    ["Plazo Original", `${years} años`],
    ["Intereses Totales", `${currency} ${totalInterest.toFixed(2)}`],
    ["Seguros Totales", `${currency} ${totalInsurance.toFixed(2)}`],
    ["Monto Total Pagado", `${currency} ${totalPaid.toFixed(2)}`],
    [""]
  ];

  // 2. Tabla del Cronograma
  const tableHeaders = [
    "Nº Cuota", "Mes", "Cuota Base", "Interés", "Capital Amortizado", 
    "Seguro Desgravamen", "Seguro Inmueble", "Prepago Extraordinario", 
    "Pago Total Mes", "Saldo Restante"
  ];

  const tableRows = currentSchedule.map(r => [
    r.monthNum,
    r.monthLabel,
    r.basePayment,
    r.interest,
    r.amortization,
    r.desgravamen,
    r.propInsurance,
    r.prepayment,
    r.totalPayment,
    r.balance
  ]);

  const fullSheetData = [...summaryData, tableHeaders, ...tableRows];

  // Crear Libro de Excel con SheetJS
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(fullSheetData);

  // Ajustar anchos de columna
  ws['!cols'] = [
    { wch: 10 }, { wch: 15 }, { wch: 14 }, { wch: 14 }, 
    { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 22 }, 
    { wch: 16 }, { wch: 16 }
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Cronograma_Pagos");

  // Descargar archivo .xlsx
  XLSX.writeFile(wb, "Cronograma_Hipoteca_Peru.xlsx");
}

function isJulOrDec(monthNumber) {
  const monthInYear = (monthNumber - 1) % 12 + 1;
  return monthInYear === 7 || monthInYear === 12;
}

function getMonthName(monthNumber) {
  const months = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
  const monthIndex = (monthNumber - 1) % 12;
  const yearOffset = Math.floor((monthNumber - 1) / 12) + 1;
  return `${months[monthIndex]} (Año ${yearOffset})`;
}

function formatCurrency(val, currencySymbol) {
  return `${currencySymbol} ${val.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
