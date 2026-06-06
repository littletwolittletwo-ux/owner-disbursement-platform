#!/usr/bin/env node
/**
 * May 2026 Owner Disbursement Analysis — CORRECTED
 * Data sourced from the real LiveLuxe report (Hostaway-based, all channels)
 *
 * CORRECTION NOTES vs previous version:
 *   1. Data comes from Hostaway (all channels), not just BDC CSV + Airbnb PDF
 *   2. Waterfall: Gross → Platform Fee (fixed %) → Net → Mgmt Fee → Cleaning → Expenses
 *   3. Cleaning fees are a SEPARATE deduction (not bundled into channel fees)
 *   4. No software fee ($65.99 was incorrect)
 *   5. Fixed BDC property mappings and management rates
 *   6. VRBO and Direct bookings now included
 */

const roundCurrency = (v) => Math.round((v + Number.EPSILON) * 100) / 100;

// Platform commission rates
const PLATFORM_RATES = { Airbnb: 0.165, 'Booking.com': 0.165, 'VRBO/HA': 0.12, Direct: 0 };

// ── All 20 properties with correct incGST management rates ──
const PROPERTIES = [
  { id: 1,  addr: '1406/172 William St',    owner: 'Michelle & Michael',      mgmt: 0.110 },
  { id: 2,  addr: '1403/172 William St',    owner: 'Michael & Michelle',      mgmt: 0.110 },
  { id: 3,  addr: '405/232 Rouse St',       owner: 'Russell',                 mgmt: 0.187 },
  { id: 4,  addr: '2003/43 Hancock St',     owner: 'Walter & Rosa / Alen',    mgmt: 0.209 },
  { id: 5,  addr: '10/105 Beach St',        owner: 'Wayne',                   mgmt: 0.165 },
  { id: 6,  addr: '6/90 Kavanagh St',       owner: 'Uros',                    mgmt: 0.110 },
  { id: 7,  addr: '2/104 Coventry St',      owner: 'Ben & Jessica',           mgmt: 0.220 },
  { id: 8,  addr: '214/181 Exhibition St',  owner: 'Alison',                  mgmt: 0.150 },  // was 16.5%, corrected to 15.0%
  { id: 9,  addr: '206/181 Exhibition St',  owner: 'Amanda',                  mgmt: 0.165 },
  { id: 10, addr: '1620/474 Flinders St',   owner: 'Richard S',               mgmt: 0.220 },
  { id: 11, addr: '811/43 Hancock St',      owner: 'Sutha & Kavith / Alen',   mgmt: 0.209 },
  { id: 12, addr: '102/1 Graham St',        owner: 'Jake',                    mgmt: 0.050 },
  { id: 13, addr: '1738/474 Flinders St',   owner: 'Stuart & Liane',          mgmt: 0.220 },
  { id: 14, addr: '3018/70 Southbank Blvd', owner: 'Dillon & Shannon / Alen', mgmt: 0.209 },
  { id: 15, addr: 'North Port Hotel',       owner: 'Boutique Accommodation',  mgmt: 0.150 },
  { id: 16, addr: '1404/43 Hancock St',     owner: 'Stephanie / Alen',        mgmt: 0.209 },
  { id: 17, addr: '1624/474 Flinders St',   owner: 'Krish',                   mgmt: 0.220 },
  { id: 18, addr: '2412/27 Little Collins', owner: 'Georgia & Nathan',        mgmt: 0.160 },
  { id: 19, addr: '512/471 Little Bourke',  owner: 'Matt & Amy L',            mgmt: 0.220 },
  { id: 20, addr: '604/172 William St',     owner: 'Matt & Amy',              mgmt: 0.220 },
];

// ── All 87 bookings from the real report (Hostaway data, all channels) ──
// Format: { propId, guest, channel, checkin, checkout, displayNights, gross, platformFee, netPayout, cleaning, paidDate }
// displayNights: "X" for full stay, "X/Y" for pro-rated straddling bookings
const BOOKINGS = [
  // #1 — 1406/172 William St (4 bookings)
  { propId:1, guest:'PETER GUALTER',     channel:'VRBO/HA',     checkin:'2026-04-30', checkout:'2026-05-04', nights:'3/4', gross:2032.76, fee:243.93,  net:1788.83, cleaning:247.50, paid:null },
  { propId:1, guest:'Emma Street',        channel:'Airbnb',      checkin:'2026-05-06', checkout:'2026-05-13', nights:'7',   gross:3239.17, fee:534.46,  net:2704.71, cleaning:330.00, paid:'May 07' },
  { propId:1, guest:'Julius Bryan Gambe', channel:'Airbnb',      checkin:'2026-05-19', checkout:'2026-05-24', nights:'5',   gross:2771.66, fee:457.32,  net:2314.34, cleaning:330.00, paid:'May 20' },
  { propId:1, guest:'Vanessa Tannavie',   channel:'Airbnb',      checkin:'2026-05-26', checkout:'2026-05-31', nights:'5',   gross:2946.04, fee:486.10,  net:2459.94, cleaning:330.00, paid:'May 27' },

  // #2 — 1403/172 William St (4 bookings)
  { propId:2, guest:'Antony Au',          channel:'Booking.com', checkin:'2026-04-27', checkout:'2026-05-03', nights:'2/6', gross:1175.67, fee:193.99,  net:981.68,  cleaning:110.00, paid:'May 08' },
  { propId:2, guest:'Kadar Abdullahi',    channel:'Airbnb',      checkin:'2026-05-04', checkout:'2026-05-06', nights:'2',   gross:1529.69, fee:252.40,  net:1277.29, cleaning:330.00, paid:'May 05' },
  { propId:2, guest:'Colette Davison',    channel:'VRBO/HA',     checkin:'2026-05-11', checkout:'2026-05-20', nights:'9',   gross:4603.06, fee:552.37,  net:4050.69, cleaning:330.00, paid:null },
  { propId:2, guest:'Jessica Burley',     channel:'Booking.com', checkin:'2026-05-21', checkout:'2026-05-25', nights:'4',   gross:2831.00, fee:467.12,  net:2363.88, cleaning:330.00, paid:'May 29' },

  // #3 — 405/232 Rouse St (5 bookings)
  { propId:3, guest:'Fernanda Mendes',    channel:'Airbnb',      checkin:'2026-04-29', checkout:'2026-05-14', nights:'13/15', gross:2395.29, fee:395.22, net:2000.07, cleaning:169.00, paid:'Apr 30' },
  { propId:3, guest:'Unknown',            channel:'Direct',      checkin:'2026-05-16', checkout:'2026-05-17', nights:'1',   gross:505.41,  fee:0,       net:505.41,  cleaning:195.00, paid:null },
  { propId:3, guest:'Chonkin Deng',       channel:'Airbnb',      checkin:'2026-05-18', checkout:'2026-05-22', nights:'4',   gross:564.79,  fee:93.19,   net:471.60,  cleaning:195.00, paid:'May 19' },
  { propId:3, guest:'Unknown',            channel:'Direct',      checkin:'2026-05-22', checkout:'2026-05-24', nights:'2',   gross:532.44,  fee:0,       net:532.44,  cleaning:195.00, paid:null },
  { propId:3, guest:'Bridget McManus',    channel:'Booking.com', checkin:'2026-05-24', checkout:'2026-05-30', nights:'6',   gross:1286.00, fee:212.19,  net:1073.81, cleaning:175.00, paid:'Jun 05' },

  // #4 — 2003/43 Hancock St (4 bookings)
  { propId:4, guest:'Hamish Crawshaw',    channel:'Airbnb',      checkin:'2026-04-23', checkout:'2026-05-12', nights:'11/19', gross:2328.43, fee:384.19, net:1944.24, cleaning:112.89, paid:'Apr 24' },
  { propId:4, guest:'Natalie Hayes',      channel:'Booking.com', checkin:'2026-05-14', checkout:'2026-05-19', nights:'5',   gross:1086.00, fee:179.19,  net:906.81,  cleaning:200.00, paid:'May 22' },
  { propId:4, guest:'Melbourne Society',  channel:'Booking.com', checkin:'2026-05-19', checkout:'2026-05-25', nights:'6',   gross:1179.00, fee:194.53,  net:984.47,  cleaning:200.00, paid:'May 29' },
  { propId:4, guest:'Arabell Looby',      channel:'Booking.com', checkin:'2026-05-30', checkout:'2026-05-31', nights:'1',   gross:370.10,  fee:61.07,   net:309.03,  cleaning:200.00, paid:'Jun 05' },

  // #5 — 10/105 Beach St (7 bookings)
  { propId:5, guest:'kiera eckley',       channel:'Booking.com', checkin:'2026-04-30', checkout:'2026-05-03', nights:'2/3', gross:312.27,  fee:51.52,   net:260.75,  cleaning:86.67,  paid:'May 08' },
  { propId:5, guest:'Rebecca Stewart',    channel:'Airbnb',      checkin:'2026-05-03', checkout:'2026-05-13', nights:'10',  gross:1298.50, fee:214.25,  net:1084.25, cleaning:130.00, paid:'May 04' },
  { propId:5, guest:'David Lister',       channel:'Booking.com', checkin:'2026-05-14', checkout:'2026-05-19', nights:'5',   gross:867.00,  fee:143.06,  net:723.94,  cleaning:130.00, paid:'May 22' },
  { propId:5, guest:'Gary Arcilla',       channel:'Booking.com', checkin:'2026-05-19', checkout:'2026-05-22', nights:'3',   gross:464.77,  fee:76.69,   net:388.08,  cleaning:130.00, paid:'May 29' },
  { propId:5, guest:'Hannah Searle',      channel:'Booking.com', checkin:'2026-05-22', checkout:'2026-05-24', nights:'2',   gross:408.96,  fee:67.48,   net:341.48,  cleaning:130.00, paid:'May 29' },
  { propId:5, guest:'Lynda Swaddling',    channel:'Airbnb',      checkin:'2026-05-22', checkout:'2026-05-26', nights:'4',   gross:684.00,  fee:112.86,  net:571.14,  cleaning:130.00, paid:'May 25' },
  { propId:5, guest:'Renae Myftarago',    channel:'Booking.com', checkin:'2026-05-24', checkout:'2026-05-28', nights:'4',   gross:485.64,  fee:80.13,   net:405.51,  cleaning:130.00, paid:'May 29' },

  // #6 — 6/90 Kavanagh St (6 bookings)
  { propId:6, guest:'Mathew (BDC)',       channel:'Booking.com', checkin:'2026-05-01', checkout:'2026-05-05', nights:'4',   gross:831.00,  fee:137.12,  net:693.88,  cleaning:130.00, paid:'May 08' },
  { propId:6, guest:'Jason Lee',          channel:'Airbnb',      checkin:'2026-05-07', checkout:'2026-05-10', nights:'3',   gross:665.94,  fee:109.88,  net:556.06,  cleaning:130.00, paid:'May 08' },
  { propId:6, guest:'Jamie Holland',      channel:'Booking.com', checkin:'2026-05-14', checkout:'2026-05-18', nights:'4',   gross:899.00,  fee:148.34,  net:750.66,  cleaning:130.00, paid:'May 22' },
  { propId:6, guest:'Aimee Repniks-Downie', channel:'Airbnb',   checkin:'2026-05-18', checkout:'2026-05-22', nights:'4',   gross:473.89,  fee:78.19,   net:395.70,  cleaning:130.00, paid:'May 19' },
  { propId:6, guest:'Samia Omar',         channel:'Airbnb',      checkin:'2026-05-22', checkout:'2026-05-26', nights:'4',   gross:663.10,  fee:109.41,  net:553.69,  cleaning:130.00, paid:'May 25' },
  { propId:6, guest:'Emma Markus',        channel:'Booking.com', checkin:'2026-05-27', checkout:'2026-05-31', nights:'4',   gross:873.00,  fee:144.05,  net:728.95,  cleaning:130.00, paid:'Jun 05' },

  // #7 — 2/104 Coventry St (7 bookings)
  { propId:7, guest:'LARRY CRIPPS',       channel:'Booking.com', checkin:'2026-04-30', checkout:'2026-05-04', nights:'3/4', gross:610.50,  fee:100.73,  net:509.77,  cleaning:142.50, paid:'May 08' },
  { propId:7, guest:'Jo-Anne Schuemaker', channel:'VRBO/HA',     checkin:'2026-05-04', checkout:'2026-05-08', nights:'4',   gross:845.00,  fee:101.40,  net:743.60,  cleaning:175.00, paid:null },
  { propId:7, guest:'Valeriia Dmitrukh',  channel:'Booking.com', checkin:'2026-05-13', checkout:'2026-05-17', nights:'4',   gross:836.00,  fee:137.94,  net:698.06,  cleaning:190.00, paid:'May 22' },
  { propId:7, guest:'Paige Meadows',      channel:'Booking.com', checkin:'2026-05-19', checkout:'2026-05-22', nights:'3',   gross:542.68,  fee:89.54,   net:453.14,  cleaning:190.00, paid:'May 29' },
  { propId:7, guest:'Stacey Lewis',       channel:'Airbnb',      checkin:'2026-05-22', checkout:'2026-05-25', nights:'3',   gross:729.15,  fee:120.31,  net:608.84,  cleaning:175.00, paid:'May 25' },
  { propId:7, guest:'Louis Van Der Heyden', channel:'Booking.com', checkin:'2026-05-25', checkout:'2026-05-26', nights:'1', gross:259.77,  fee:42.86,   net:216.91,  cleaning:190.00, paid:'May 29' },
  { propId:7, guest:'Louis Van Der Heyden', channel:'Booking.com', checkin:'2026-05-26', checkout:'2026-05-27', nights:'1', gross:259.77,  fee:42.86,   net:216.91,  cleaning:190.00, paid:'May 29' },

  // #8 — 214/181 Exhibition St (5 bookings)
  { propId:8, guest:'Gooden Dan',         channel:'Booking.com', checkin:'2026-05-01', checkout:'2026-05-05', nights:'4',   gross:973.00,  fee:160.55,  net:812.45,  cleaning:190.00, paid:'May 08' },
  { propId:8, guest:'johan ferreiraa',    channel:'Booking.com', checkin:'2026-05-07', checkout:'2026-05-12', nights:'5',   gross:1324.00, fee:218.46,  net:1105.54, cleaning:190.00, paid:'May 15' },
  { propId:8, guest:'Sarah Horn',         channel:'Airbnb',      checkin:'2026-05-15', checkout:'2026-05-17', nights:'2',   gross:411.34,  fee:67.87,   net:343.47,  cleaning:190.00, paid:'May 18' },
  { propId:8, guest:'Kayla Weidemann',    channel:'Airbnb',      checkin:'2026-05-22', checkout:'2026-05-24', nights:'2',   gross:626.48,  fee:103.37,  net:523.11,  cleaning:190.00, paid:'May 25' },
  { propId:8, guest:'Carla Collin',       channel:'Airbnb',      checkin:'2026-05-25', checkout:'2026-05-29', nights:'4',   gross:514.06,  fee:84.82,   net:429.24,  cleaning:190.00, paid:'May 26' },

  // #9 — 206/181 Exhibition St (3 bookings)
  { propId:9, guest:"Imani O'Brien",      channel:'Booking.com', checkin:'2026-05-06', checkout:'2026-05-10', nights:'4',   gross:873.00,  fee:144.05,  net:728.95,  cleaning:190.00, paid:'May 15' },
  { propId:9, guest:'David Davitkov',     channel:'Booking.com', checkin:'2026-05-12', checkout:'2026-05-26', nights:'14',  gross:2503.00, fee:413.00,  net:2090.00, cleaning:190.00, paid:'May 29' },
  { propId:9, guest:'Evan Peretin',       channel:'Airbnb',      checkin:'2026-05-30', checkout:'2026-05-31', nights:'1',   gross:460.81,  fee:76.03,   net:384.78,  cleaning:190.00, paid:'Jun 01' },

  // #10 — 1620/474 Flinders St (6 bookings)
  { propId:10, guest:'Scott Deeth',       channel:'Booking.com', checkin:'2026-04-30', checkout:'2026-05-03', nights:'2/3', gross:456.67,  fee:75.35,   net:381.32,  cleaning:126.67, paid:'May 08' },
  { propId:10, guest:'Jordan Gillum',     channel:'Booking.com', checkin:'2026-05-08', checkout:'2026-05-11', nights:'3',   gross:730.00,  fee:120.45,  net:609.55,  cleaning:190.00, paid:'May 15' },
  { propId:10, guest:'Thomas Ballard',    channel:'VRBO/HA',     checkin:'2026-05-13', checkout:'2026-05-17', nights:'4',   gross:986.36,  fee:118.36,  net:868.00,  cleaning:175.00, paid:null },
  { propId:10, guest:'Emma Lucas',        channel:'Airbnb',      checkin:'2026-05-21', checkout:'2026-05-25', nights:'4',   gross:695.58,  fee:114.77,  net:580.81,  cleaning:175.00, paid:'May 22' },
  { propId:10, guest:'Christopher Do',    channel:'Airbnb',      checkin:'2026-05-26', checkout:'2026-05-29', nights:'3',   gross:339.67,  fee:56.05,   net:283.62,  cleaning:175.00, paid:'May 27' },
  { propId:10, guest:'Pippa Leworthy',    channel:'Airbnb',      checkin:'2026-05-30', checkout:'2026-05-31', nights:'1',   gross:488.49,  fee:80.60,   net:407.89,  cleaning:175.00, paid:'Jun 01' },

  // #11 — 811/43 Hancock St (5 bookings)
  { propId:11, guest:'Zack Roberts',      channel:'Booking.com', checkin:'2026-04-29', checkout:'2026-05-03', nights:'2/4', gross:415.00,  fee:68.48,   net:346.52,  cleaning:95.00,  paid:'May 08' },
  { propId:11, guest:'Amber Sosene',      channel:'Booking.com', checkin:'2026-05-07', checkout:'2026-05-11', nights:'4',   gross:778.00,  fee:128.37,  net:649.63,  cleaning:190.00, paid:'May 15' },
  { propId:11, guest:'Guido Merlo',       channel:'Booking.com', checkin:'2026-05-13', checkout:'2026-05-17', nights:'4',   gross:778.00,  fee:128.37,  net:649.63,  cleaning:190.00, paid:'May 22' },
  { propId:11, guest:'Sam Gibson',        channel:'Airbnb',      checkin:'2026-05-19', checkout:'2026-05-22', nights:'3',   gross:466.93,  fee:77.04,   net:389.89,  cleaning:175.00, paid:'May 20' },
  { propId:11, guest:'Aby Philip',        channel:'Airbnb',      checkin:'2026-05-22', checkout:'2026-05-28', nights:'6',   gross:888.27,  fee:146.56,  net:741.71,  cleaning:175.00, paid:'May 25' },

  // #12 — 102/1 Graham St (5 bookings)
  { propId:12, guest:'William Armour',    channel:'Airbnb',      checkin:'2026-05-01', checkout:'2026-05-03', nights:'2',   gross:442.00,  fee:72.93,   net:369.07,  cleaning:115.00, paid:'May 04' },
  { propId:12, guest:'Lee Pickering',     channel:'Booking.com', checkin:'2026-05-04', checkout:'2026-05-08', nights:'4',   gross:570.64,  fee:94.16,   net:476.48,  cleaning:130.00, paid:'May 15' },
  { propId:12, guest:'Yashua Lesa',       channel:'Booking.com', checkin:'2026-05-09', checkout:'2026-05-16', nights:'7',   gross:841.75,  fee:138.89,  net:702.86,  cleaning:130.00, paid:'May 22' },
  { propId:12, guest:'Michael Grant',     channel:'Airbnb',      checkin:'2026-05-17', checkout:'2026-05-23', nights:'6',   gross:824.44,  fee:136.03,  net:688.41,  cleaning:115.00, paid:'May 18' },
  { propId:12, guest:'Mauricio Araújo Garcia', channel:'Airbnb', checkin:'2026-05-23', checkout:'2026-05-27', nights:'4',   gross:446.21,  fee:73.62,   net:372.59,  cleaning:115.00, paid:'May 25' },

  // #13 — 1738/474 Flinders St (3 bookings)
  { propId:13, guest:'Rylee Condron',     channel:'Booking.com', checkin:'2026-05-02', checkout:'2026-05-06', nights:'4',   gross:995.00,  fee:164.18,  net:830.82,  cleaning:190.00, paid:'May 08' },
  { propId:13, guest:'Unknown',           channel:'Direct',      checkin:'2026-05-14', checkout:'2026-05-18', nights:'4',   gross:1370.29, fee:0,       net:1370.29, cleaning:175.00, paid:null },
  { propId:13, guest:'Brendan McConnell', channel:'Airbnb',      checkin:'2026-05-23', checkout:'2026-05-24', nights:'1',   gross:315.12,  fee:51.99,   net:263.13,  cleaning:175.00, paid:'May 25' },

  // #14 — 3018/70 Southbank Blvd (3 bookings)
  { propId:14, guest:'Simon Pedler',      channel:'Airbnb',      checkin:'2026-04-28', checkout:'2026-05-11', nights:'10/13', gross:1840.86, fee:303.74, net:1537.12, cleaning:150.00, paid:'Apr 29' },
  { propId:14, guest:'Steve Bloomfield',  channel:'Airbnb',      checkin:'2026-05-21', checkout:'2026-05-22', nights:'1',   gross:196.70,  fee:32.46,   net:164.24,  cleaning:195.00, paid:'May 22' },
  { propId:14, guest:'Lateesha Lia',      channel:'Airbnb',      checkin:'2026-05-23', checkout:'2026-05-25', nights:'2',   gross:380.81,  fee:62.83,   net:317.98,  cleaning:195.00, paid:'May 25' },

  // #15 — North Port Hotel (9 bookings)
  { propId:15, guest:'Louise Everding',   channel:'Booking.com', checkin:'2026-04-30', checkout:'2026-05-01', nights:'0/1', gross:0,       fee:0,       net:0,       cleaning:0,      paid:'May 08' },
  { propId:15, guest:'Liam McKeon',       channel:'Booking.com', checkin:'2026-05-01', checkout:'2026-05-03', nights:'2',   gross:354.00,  fee:58.41,   net:295.59,  cleaning:60.00,  paid:'May 08' },
  { propId:15, guest:'Greg White',        channel:'VRBO/HA',     checkin:'2026-05-02', checkout:'2026-05-03', nights:'1',   gross:291.10,  fee:34.93,   net:256.17,  cleaning:60.00,  paid:null },
  { propId:15, guest:'Sophia Gatti',      channel:'Booking.com', checkin:'2026-05-08', checkout:'2026-05-10', nights:'2',   gross:330.00,  fee:54.45,   net:275.55,  cleaning:60.00,  paid:'May 15' },
  { propId:15, guest:'George Atrache',    channel:'Airbnb',      checkin:'2026-05-28', checkout:'2026-05-29', nights:'1',   gross:119.40,  fee:19.70,   net:99.70,   cleaning:60.00,  paid:'May 29' },
  { propId:15, guest:'James Fragnito',    channel:'Airbnb',      checkin:'2026-05-27', checkout:'2026-05-29', nights:'2',   gross:165.60,  fee:27.32,   net:138.28,  cleaning:60.00,  paid:'May 28' },
  { propId:15, guest:'Paul Devlin',       channel:'Booking.com', checkin:'2026-05-28', checkout:'2026-05-29', nights:'1',   gross:136.86,  fee:22.58,   net:114.28,  cleaning:60.00,  paid:'Jun 05' },
  { propId:15, guest:'Md Atahar Hossain', channel:'Booking.com', checkin:'2026-05-25', checkout:'2026-05-30', nights:'5',   gross:849.00,  fee:140.09,  net:708.91,  cleaning:60.00,  paid:'Jun 05' },
  { propId:15, guest:'Fahim Faisal',      channel:'Airbnb',      checkin:'2026-05-30', checkout:'2026-05-31', nights:'1',   gross:119.00,  fee:19.64,   net:99.36,   cleaning:60.00,  paid:'Jun 01' },

  // #16 — 1404/43 Hancock St (3 bookings)
  { propId:16, guest:'Gianluca Patti',    channel:'Booking.com', checkin:'2026-05-01', checkout:'2026-05-03', nights:'2',   gross:484.00,  fee:79.86,   net:404.14,  cleaning:190.00, paid:'May 08' },
  { propId:16, guest:'aaron suffield',    channel:'Booking.com', checkin:'2026-05-06', checkout:'2026-05-10', nights:'4',   gross:778.00,  fee:128.37,  net:649.63,  cleaning:190.00, paid:'May 15' },
  { propId:16, guest:'WANG CHENG-SHENG',  channel:'Booking.com', checkin:'2026-05-11', checkout:'2026-05-16', nights:'5',   gross:995.00,  fee:164.18,  net:830.82,  cleaning:190.00, paid:'May 22' },

  // #17 — 1624/474 Flinders St (4 bookings)
  { propId:17, guest:'Jared Hall',        channel:'VRBO/HA',     checkin:'2026-04-30', checkout:'2026-05-02', nights:'1/2', gross:307.01,  fee:36.84,   net:270.17,  cleaning:90.00,  paid:null },
  { propId:17, guest:'Lisa Ann',          channel:'Airbnb',      checkin:'2026-05-22', checkout:'2026-05-24', nights:'2',   gross:448.17,  fee:73.95,   net:374.22,  cleaning:180.00, paid:'May 25' },
  { propId:17, guest:'Le Nguyen',         channel:'Airbnb',      checkin:'2026-05-25', checkout:'2026-05-30', nights:'5',   gross:589.43,  fee:97.26,   net:492.17,  cleaning:180.00, paid:'May 26' },
  { propId:17, guest:'Nea Ferraro',       channel:'Airbnb',      checkin:'2026-05-30', checkout:'2026-05-31', nights:'1',   gross:310.41,  fee:51.22,   net:259.19,  cleaning:180.00, paid:'Jun 01' },

  // #18 — 2412/27 Little Collins (1 booking)
  { propId:18, guest:'Delayna Samm',      channel:'Airbnb',      checkin:'2026-05-22', checkout:'2026-05-31', nights:'9',   gross:1080.78, fee:178.33,  net:902.45,  cleaning:130.00, paid:'May 25' },

  // #19 — 512/471 Little Bourke (3 bookings)
  { propId:19, guest:'Ruxan Roohullah',   channel:'Airbnb',      checkin:'2026-05-22', checkout:'2026-05-24', nights:'2',   gross:344.19,  fee:56.79,   net:287.40,  cleaning:135.00, paid:'May 25' },
  { propId:19, guest:'Tomas Morello',     channel:'Airbnb',      checkin:'2026-05-27', checkout:'2026-05-30', nights:'3',   gross:454.19,  fee:74.94,   net:379.25,  cleaning:135.00, paid:'May 28' },
  { propId:19, guest:'Akot Deng',         channel:'Airbnb',      checkin:'2026-05-30', checkout:'2026-05-31', nights:'1',   gross:221.68,  fee:36.58,   net:185.10,  cleaning:135.00, paid:'Jun 01' },

  // #20 — 604/172 William St (0 bookings — no activity)
];

// ── Owner expenses ──
const EXPENSES = [
  { propId: 1,  items: [{ desc:'Maintenance charge', amount:165.00 }] },
  { propId: 2,  items: [{ desc:'Insurance', amount:353.65 }, { desc:'Water bill', amount:316.68 }, { desc:'Missing fob (Terry\'s Locksmiths)', amount:29.24 }] },
  { propId: 3,  items: [{ desc:'Owner stay cleaning (17 May)', amount:100.00 }, { desc:'Owner stay cleaning (24 May)', amount:100.00 }, { desc:'New coffee machine', amount:60.00 }] },
  { propId: 7,  items: [{ desc:'Window replacement', amount:800.00 }] },
  { propId: 10, items: [{ desc:'Dishwasher replacement', amount:949.00 }] },
  { propId: 13, items: [{ desc:'Locksmith', amount:814.00 }, { desc:'New coffee machine', amount:60.00 }, { desc:'Artwork hanging (Bunnings)', amount:58.16 }] },
  { propId: 16, items: [{ desc:'Origin Energy utilities', amount:225.50 }, { desc:'Origin Energy utilities', amount:134.72 }] },
  { propId: 17, items: [{ desc:'Portable WiFi', amount:78.00 }] },
];

// ── Management fee discounts ──
const DISCOUNTS = [
  { propId: 2,  waiverPct: 0.40, boost: 0 },
  { propId: 7,  waiverPct: 0.55, boost: 0 },
  { propId: 8,  waiverPct: 0.60, boost: 0 },
  { propId: 10, waiverPct: 0.95, boost: 0 },
  { propId: 11, waiverPct: 1.00, boost: 228.53 },
  { propId: 12, waiverPct: 1.00, boost: 59.53 },
  { propId: 13, waiverPct: 1.00, boost: 102.87 },
  { propId: 16, waiverPct: 1.00, boost: 111.12 },
];

// ── MAIN ──
function main() {
  console.log('');
  console.log('='.repeat(110));
  console.log('  MAY 2026 OWNER DISBURSEMENT — CORRECTED ANALYSIS');
  console.log('  Period: May 1 – 31, 2026  |  Data: Hostaway (all channels)  |  87 bookings, 20 properties');
  console.log('='.repeat(110));

  const results = [];

  for (const p of PROPERTIES) {
    const bkgs = BOOKINGS.filter(b => b.propId === p.id);
    const exp = EXPENSES.find(e => e.propId === p.id);
    const disc = DISCOUNTS.find(d => d.propId === p.id);

    const gross = roundCurrency(bkgs.reduce((s, b) => s + b.gross, 0));
    const platformFees = roundCurrency(bkgs.reduce((s, b) => s + b.fee, 0));
    const netPayout = roundCurrency(gross - platformFees);
    const cleaning = roundCurrency(bkgs.reduce((s, b) => s + b.cleaning, 0));

    // Management fee
    const fullMgmt = roundCurrency(netPayout * p.mgmt);
    let waiverAmt = 0, boostAmt = 0;
    if (disc) {
      waiverAmt = roundCurrency(fullMgmt * disc.waiverPct);
      boostAmt = disc.boost;
    }
    const effectiveMgmt = roundCurrency(fullMgmt - waiverAmt - boostAmt);
    const totalDiscount = roundCurrency(waiverAmt + boostAmt);

    // Expenses
    const totalExpenses = exp ? roundCurrency(exp.items.reduce((s, i) => s + i.amount, 0)) : 0;

    // Owner net and final
    const ownerNet = roundCurrency(netPayout - effectiveMgmt - cleaning);
    const finalPayout = roundCurrency(ownerNet - totalExpenses);

    // Channel breakdown
    const byChannel = {};
    for (const b of bkgs) {
      if (!byChannel[b.channel]) byChannel[b.channel] = { gross: 0, fee: 0, net: 0, cleaning: 0, count: 0 };
      byChannel[b.channel].gross += b.gross;
      byChannel[b.channel].fee += b.fee;
      byChannel[b.channel].net += b.net;
      byChannel[b.channel].cleaning += b.cleaning;
      byChannel[b.channel].count++;
    }

    results.push({
      ...p, bkgs, gross, platformFees, netPayout, cleaning,
      fullMgmt, waiverAmt, boostAmt, effectiveMgmt, totalDiscount,
      totalExpenses, expItems: exp?.items || [],
      ownerNet, finalPayout, byChannel,
    });
  }

  // ── SUMMARY TABLE ──
  console.log('');
  console.log('═'.repeat(110));
  console.log('  FINAL DISBURSEMENT SUMMARY');
  console.log('═'.repeat(110));
  const hdr = [
    '#'.padStart(3), 'Property'.padEnd(24), 'Owner'.padEnd(22), 'Bk'.padStart(2),
    'Gross'.padStart(11), 'Platform'.padStart(10), 'Net'.padStart(10),
    'Eff Mgmt'.padStart(10), 'Cleaning'.padStart(10),
    'Expenses'.padStart(9), 'PAYOUT'.padStart(11),
  ].join(' | ');
  console.log(hdr);
  console.log('-'.repeat(hdr.length));

  let tGross=0, tPlat=0, tNet=0, tMgmt=0, tClean=0, tExp=0, tPay=0, tBk=0;
  for (const r of results) {
    const row = [
      String(r.id).padStart(3),
      r.addr.substring(0,24).padEnd(24),
      r.owner.substring(0,22).padEnd(22),
      String(r.bkgs.length).padStart(2),
      fm(r.gross).padStart(11),
      fm(-r.platformFees).padStart(10),
      fm(r.netPayout).padStart(10),
      fm(-r.effectiveMgmt).padStart(10),
      fm(-r.cleaning).padStart(10),
      (r.totalExpenses > 0 ? fm(-r.totalExpenses) : '—').padStart(9),
      fm(r.finalPayout).padStart(11),
    ].join(' | ');
    console.log(row);
    tGross+=r.gross; tPlat+=r.platformFees; tNet+=r.netPayout;
    tMgmt+=r.effectiveMgmt; tClean+=r.cleaning; tExp+=r.totalExpenses;
    tPay+=r.finalPayout; tBk+=r.bkgs.length;
  }
  console.log('-'.repeat(hdr.length));
  const totRow = [
    '   ', 'TOTALS'.padEnd(24), ''.padEnd(22), String(tBk).padStart(2),
    fm(tGross).padStart(11), fm(-tPlat).padStart(10), fm(tNet).padStart(10),
    fm(-tMgmt).padStart(10), fm(-tClean).padStart(10),
    fm(-tExp).padStart(9), fm(tPay).padStart(11),
  ].join(' | ');
  console.log(totRow);

  // ── GRAND WATERFALL ──
  console.log('\n');
  console.log('  GRAND WATERFALL');
  console.log('  ─────────────────────────────────────────');
  console.log(`  Total Gross Revenue:           ${fm(tGross).padStart(12)}`);
  console.log(`  Less: Platform Commissions:    ${fm(-tPlat).padStart(12)}`);

  // Channel breakdown
  const allChannels = {};
  for (const r of results) for (const [ch, d] of Object.entries(r.byChannel)) {
    if (!allChannels[ch]) allChannels[ch] = 0;
    allChannels[ch] += d.fee;
  }
  for (const [ch, fee] of Object.entries(allChannels)) {
    const rate = PLATFORM_RATES[ch] ? `${(PLATFORM_RATES[ch]*100).toFixed(1)}%` : '';
    console.log(`    ${ch} (${rate}):`.padEnd(32) + fm(-roundCurrency(fee)).padStart(12));
  }

  console.log(`  = Net Payout:                  ${fm(tNet).padStart(12)}`);
  const fullMgmtTot = results.reduce((s,r)=>s+r.fullMgmt,0);
  const waiverTot = results.reduce((s,r)=>s+r.waiverAmt,0);
  const boostTot = results.reduce((s,r)=>s+r.boostAmt,0);
  console.log(`  Less: Management Fees (full):  ${fm(-fullMgmtTot).padStart(12)}`);
  console.log(`  Plus: Mgmt Fee Discounts:      ${fm(roundCurrency(waiverTot+boostTot)).padStart(12)}`);
  console.log(`    Effective Mgmt Fees:`.padEnd(32) + fm(-tMgmt).padStart(12));
  console.log(`  Less: Cleaning Fees:           ${fm(-tClean).padStart(12)}`);
  console.log(`  ═════════════════════════════════════════`);
  console.log(`  = Owner Net (before expenses): ${fm(roundCurrency(tNet-tMgmt-tClean)).padStart(12)}`);
  console.log(`  Less: Owner Expenses:          ${fm(-tExp).padStart(12)}`);
  console.log(`  ═════════════════════════════════════════`);
  console.log(`  = FINAL DISBURSEMENT:          ${fm(tPay).padStart(12)}`);

  // ── PER-PROPERTY DETAIL ──
  console.log('\n');
  console.log('═'.repeat(110));
  console.log('  PER-PROPERTY DETAIL');
  console.log('═'.repeat(110));

  for (const r of results) {
    console.log('');
    console.log(`── #${r.id} ${r.addr} — ${r.owner}  [Mgmt: ${(r.mgmt*100).toFixed(1)}%]  →  PAYOUT: ${fm(r.finalPayout)} ──`);

    if (r.bkgs.length === 0) {
      console.log('   No May 2026 activity');
      continue;
    }

    // Bookings table
    console.log('   Bookings:');
    for (const b of r.bkgs) {
      const proNote = b.nights.includes('/') ? ` (pro-rated ${b.nights})` : '';
      const paidNote = b.paid ? (b.paid.startsWith('Jun') ? ` [UNPAID→${b.paid}]` : ` [${b.paid}]`) : ' [VRBO/pending]';
      console.log(`     ${b.channel.padEnd(12)} ${b.checkin}→${b.checkout} ${String(b.nights).padStart(5)} nts | Gross ${fm(b.gross).padStart(9)} | Fee ${fm(-b.fee).padStart(8)} | Net ${fm(b.net).padStart(9)} | Clean ${fm(b.cleaning).padStart(7)}${proNote}${paidNote}`);
    }

    // Waterfall
    console.log('   Waterfall:');
    console.log(`     Gross Revenue:              ${fm(r.gross).padStart(11)}`);
    console.log(`     Less: Platform Commissions: ${fm(-r.platformFees).padStart(11)}`);
    for (const [ch, d] of Object.entries(r.byChannel)) {
      const rate = PLATFORM_RATES[ch] ? `${(PLATFORM_RATES[ch]*100).toFixed(1)}%` : '0%';
      console.log(`       ${ch} (${rate}):`.padEnd(34) + fm(-roundCurrency(d.fee)).padStart(11));
    }
    console.log(`     = Net Payout:               ${fm(r.netPayout).padStart(11)}`);
    console.log(`     Less: Management Fee (${(r.mgmt*100).toFixed(1)}%): ${fm(-r.fullMgmt).padStart(11)}`);
    if (r.totalDiscount > 0) {
      if (r.waiverAmt > 0) console.log(`     Plus: Waiver (${Math.round((DISCOUNTS.find(d=>d.propId===r.id)?.waiverPct||0)*100)}%):           +${fm(r.waiverAmt).padStart(10)}`);
      if (r.boostAmt > 0) console.log(`     Plus: Boost:                +${fm(r.boostAmt).padStart(10)}`);
      console.log(`       Effective Mgmt:`.padEnd(36) + fm(-r.effectiveMgmt).padStart(11));
    }
    console.log(`     Less: Cleaning Fees:        ${fm(-r.cleaning).padStart(11)}`);
    console.log(`     = Owner Net:                ${fm(r.ownerNet).padStart(11)}`);
    if (r.totalExpenses > 0) {
      console.log(`     Less: Expenses:`);
      for (const e of r.expItems) console.log(`       ${e.desc.padEnd(32)} ${fm(-e.amount).padStart(11)}`);
      console.log(`       Total Expenses:`.padEnd(36) + fm(-r.totalExpenses).padStart(11));
    }
    console.log(`     ═══════════════════════════════════`);
    console.log(`     FINAL PAYOUT:               ${fm(r.finalPayout).padStart(11)}`);
  }

  console.log('');
}

function fm(v) {
  const n = Number(v);
  if (n === 0) return '$0.00';
  return `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(2)}`;
}

main();
