import { addWorkdays, maxDate, minDate, nextWorkday, normalizeWorkday, toDateString } from '../lib/scheduleDates.js'

export const JEFFERSON_SCHEDULE_START = '2026-08-03'
export const JEFFERSON_CONSTRUCTION_START = '2026-08-24'

const task = (key, name, duration, trade, dependsOn = [], options = {}) => ({
  key,
  name,
  duration,
  trade,
  dependsOn,
  type: options.type || 'work',
  references: options.references || '',
  notBefore: options.notBefore,
  notes: options.notes || '',
})

export const JEFFERSON_PHASES = [
  {
    key: 'preconstruction', name: 'Preconstruction & Procurement', color: '#5e5ce6', tasks: [
      task('permit_release', 'Permit release & preconstruction conference', 3, 'GC / Owner', [], { type: 'milestone', references: 'Permit set G0.0' }),
      task('survey_locates', 'Utility locates & survey control', 2, 'Survey / Utilities', ['permit_release'], { references: 'A1.0' }),
      task('site_logistics', 'Site logistics, temporary facilities & erosion plan', 3, 'GC', ['permit_release'], { references: 'A1.0, G2.1' }),
      task('release_windows', 'Release windows & exterior doors', 1, 'Owner / Supplier', [], { type: 'procurement', references: 'G3.1' }),
      task('fabricate_windows', 'Window & exterior door fabrication (long lead)', 45, 'Window Supplier', ['release_windows'], { type: 'procurement', references: 'G3.1' }),
      task('truss_submittal', 'Truss deferred submittal, EOR review & fabrication', 25, 'Truss Supplier / EOR', [], { type: 'procurement', references: 'S1.0, S2.4', notes: 'Structural review allowance includes the specified 10 working days.' }),
      task('release_equipment', 'Release roofing, HVAC/ERV & electrical gear', 1, 'GC / MEP', [], { type: 'procurement', references: 'G3.0, M0.3' }),
      task('fabricate_equipment', 'Long-lead roofing and MEP equipment', 30, 'Suppliers', ['release_equipment'], { type: 'procurement', references: 'G3.0, M0.3' }),
      task('finalize_finishes', 'Finalize cabinetry, appliances & finish selections', 10, 'Owner / Designer', [], { type: 'procurement', references: 'A2.0' }),
      task('fabricate_cabinets', 'Cabinetry fabrication (long lead)', 55, 'Cabinet Supplier', ['finalize_finishes'], { type: 'procurement', references: 'A2.0' }),
      task('mobilize', 'Mobilize site, fencing, dumpster & temporary utilities', 2, 'GC', ['site_logistics', 'survey_locates'], { notBefore: '2026-08-20', references: 'A1.0' }),
      task('construction_start', 'Construction start', 1, 'GC', ['mobilize'], { type: 'milestone', notBefore: JEFFERSON_CONSTRUCTION_START }),
    ],
  },
  {
    key: 'demolition', name: 'Demolition & Abatement', color: '#ff453a', tasks: [
      task('disconnects', 'Utility disconnects and hazardous-material controls', 2, 'Abatement / Utilities', ['construction_start'], { references: 'A1.1' }),
      task('abatement', 'Asbestos abatement and clearance', 10, 'Abatement', ['disconnects'], { references: 'A1.1' }),
      task('selective_demo', 'Selective demolition - existing house & garage conversion', 10, 'Demolition', ['abatement'], { references: 'A1.1' }),
      task('structural_demo', 'Structural deconstruction for addition tie-in', 5, 'Demolition / Framing', ['selective_demo'], { references: 'A1.1, S2.2' }),
      task('demo_cleanup', 'Debris haul-off and subgrade cleanup', 3, 'Demolition', ['structural_demo']),
    ],
  },
  {
    key: 'sitework', name: 'Site Work & Excavation', color: '#32ade6', tasks: [
      task('erosion_control', 'Install erosion, tree & neighbor protection', 2, 'Sitework', ['construction_start'], { references: 'A1.0, G2.1' }),
      task('layout', 'House and garage layout', 2, 'Survey / Sitework', ['demo_cleanup', 'survey_locates'], { references: 'A1.0, S2.0' }),
      task('site_clearing', 'Site clearing and access preparation', 2, 'Sitework', ['demo_cleanup', 'erosion_control'], { references: 'A1.0' }),
      task('excavation', 'Excavate house crawlspace and garage foundations', 5, 'Excavation', ['layout', 'site_clearing'], { references: 'S2.0, soils pp. 5-6' }),
      task('geotech_footing', 'INSPECTION - Geotechnical footing bearing observation', 1, 'Geotechnical Engineer', ['excavation'], { type: 'inspection', references: 'Soils report p. 6' }),
    ],
  },
  {
    key: 'foundation', name: 'Foundations - House & Garage', color: '#ff9f0a', tasks: [
      task('footing_rebar', 'Form and reinforce house & garage footings', 4, 'Concrete', ['geotech_footing'], { references: 'S2.0, S5.0' }),
      task('footing_inspection', 'INSPECTION - City footing, rebar & Ufer ground', 1, 'City / Electrical', ['footing_rebar'], { type: 'inspection', references: 'S1.0, S2.0' }),
      task('footing_pour', 'Pour house & garage footings', 1, 'Concrete', ['footing_inspection'], { references: 'S2.0' }),
      task('footing_cure', 'Footing cure and strip', 2, 'Concrete', ['footing_pour'], { type: 'wait' }),
      task('wall_forms', 'Foundation walls, piers, embeds & holdowns', 5, 'Concrete', ['footing_cure'], { references: 'S2.1, S2.3, S5.0' }),
      task('wall_inspection', 'INSPECTION - City foundation rebar, embeds & holdowns', 1, 'City / Structural', ['wall_forms'], { type: 'inspection', references: 'S2.1, S2.3' }),
      task('wall_pour', 'Pour foundation walls and piers', 1, 'Concrete', ['wall_inspection'], { references: 'S2.1' }),
      task('wall_cure', 'Foundation wall cure and strip', 4, 'Concrete', ['wall_pour'], { type: 'wait' }),
      task('drain_waterproof', 'Crawlspace underdrain, sump, dampproofing & R-15', 5, 'Waterproofing / Excavation', ['wall_cure'], { references: 'G3.0, soils pp. 7-8' }),
      task('drain_observation', 'INSPECTION - Geotech underdrain & dampproofing observation', 1, 'Geotechnical Engineer', ['drain_waterproof'], { type: 'inspection', references: 'Soils report p. 8' }),
      task('garage_underground', 'Garage under-slab utilities and sleeves', 3, 'Plumbing / Electrical', ['wall_cure'], { references: 'S2.1, A2.0' }),
      task('underground_inspection', 'INSPECTION - City underground MEP', 1, 'City / MEP', ['garage_underground'], { type: 'inspection' }),
      task('garage_slab_prep', 'Garage slab base, vapor barrier & reinforcing', 3, 'Concrete', ['underground_inspection'], { references: 'S2.1, G3.0, soils p. 7' }),
      task('slab_inspection', 'INSPECTION - City garage slab preparation', 1, 'City', ['garage_slab_prep'], { type: 'inspection', references: 'S2.1' }),
      task('garage_slab_pour', 'Pour garage slab', 1, 'Concrete', ['slab_inspection'], { references: 'S2.1' }),
      task('garage_slab_cure', 'Garage slab cure / strength gain', 3, 'Concrete', ['garage_slab_pour'], { type: 'wait' }),
      task('crawl_ground', 'Crawlspace grading, drain stone & vapor barrier', 2, 'Waterproofing / Sitework', ['drain_observation'], { references: 'M2.0, soils pp. 7-8' }),
      task('backfill', 'Controlled backfill after floor diaphragm support', 3, 'Excavation', ['drain_observation', 'floor_system'], { references: 'S1.0 note 6, soils pp. 5-6', notes: 'Do not backfill unsupported foundation walls unless engineered temporary bracing is provided.' }),
    ],
  },
  {
    key: 'framing', name: 'Framing & Structure', color: '#0a84ff', tasks: [
      task('framing_delivery', 'Lumber, steel and truss delivery', 1, 'Framing Supplier', ['wall_cure', 'truss_submittal'], { type: 'procurement', references: 'S2.2, S2.4' }),
      task('sill_ledger', 'Sill plates, ledgers, beams and steel columns', 2, 'Framing', ['framing_delivery'], { references: 'S2.2' }),
      task('floor_system', 'House floor beams, TJI joists and subfloor diaphragm', 5, 'Framing', ['sill_ledger'], { references: 'S2.2, S5.0' }),
      task('exterior_walls', 'House exterior and shear wall framing', 7, 'Framing', ['floor_system'], { references: 'S2.3' }),
      task('interior_walls', 'Interior walls, headers and equipment openings', 5, 'Framing', ['exterior_walls'], { references: 'A2.0, S2.2' }),
      task('garage_walls', 'Garage wall framing', 4, 'Framing', ['garage_slab_cure', 'framing_delivery'], { references: 'A2.0, S2.3' }),
      task('roof_framing', 'House & garage roof framing / truss erection', 7, 'Framing / Truss', ['exterior_walls', 'garage_walls', 'truss_submittal'], { references: 'A2.1, S2.4' }),
      task('sheathing', 'Wall and roof sheathing / shear nailing', 5, 'Framing', ['roof_framing', 'interior_walls'], { references: 'S2.3, S2.4' }),
      task('blocking', 'Cabinet, bath, AV and MEP backing / fireblocking', 3, 'Framing', ['interior_walls'], { references: 'A2.0' }),
      task('shear_inspection', 'INSPECTION - Structural/shear nailing & framing observation', 1, 'City / Structural Engineer', ['sheathing', 'blocking'], { type: 'inspection', references: 'S2.3, S2.4' }),
    ],
  },
  {
    key: 'dryin', name: 'Roofing & Exterior Dry-In', color: '#30d158', tasks: [
      task('roof_underlay', 'Roof underlayment and ice/water protection', 2, 'Roofing', ['sheathing', 'fabricate_equipment'], { references: 'G3.0, A2.1' }),
      task('membrane_roof', '60-mil membrane low-slope roof and tapered insulation', 3, 'Roofing', ['roof_underlay'], { references: 'G3.0, A2.1' }),
      task('shingle_roof', 'Asphalt shingle roofs - house & garage', 4, 'Roofing', ['roof_underlay'], { references: 'G3.0, A2.1' }),
      task('roof_flashings', 'Roof drains, flashings and penetrations', 2, 'Roofing / Sheet Metal', ['membrane_roof', 'shingle_roof'], { references: 'A2.1' }),
      task('wrb', 'WRB, opening flashings and continuous air barrier', 3, 'Exterior / Framing', ['sheathing'], { references: 'A2.0, G3.0' }),
      task('windows_install', 'Install windows and exterior doors', 5, 'Window / Door Installer', ['wrb', 'fabricate_windows'], { references: 'G3.1, A2.0' }),
      task('dryin_milestone', 'Weather-tight dry-in complete', 1, 'GC', ['roof_flashings', 'windows_install'], { type: 'milestone' }),
      task('fascia_soffit', 'Fascia, soffit and exterior trim', 4, 'Exterior Carpenter', ['roof_flashings']),
      task('brick', 'Brick veneer', 7, 'Masonry', ['wrb', 'windows_install'], { references: 'G3.0, A5.0-A5.1' }),
      task('siding', 'Vertical wood / fiber-cement siding', 10, 'Siding', ['wrb', 'windows_install'], { references: 'G3.0, A5.0-A5.1' }),
      task('exterior_finish', 'Exterior paint and stain', 7, 'Painter', ['brick', 'siding', 'fascia_soffit'], { references: 'A5.0-A5.1' }),
      task('gutters', 'Gutters, downspouts and drainage extensions', 2, 'Sheet Metal', ['exterior_finish', 'roof_flashings'], { references: 'A1.0, soils p. 8' }),
    ],
  },
  {
    key: 'rough_mep', name: 'Rough MEP & Close-In Inspections', color: '#bf5af2', tasks: [
      task('mep_layout', 'Coordinated MEP layout and equipment verification', 2, 'GC / MEP', ['dryin_milestone', 'blocking'], { references: 'A2.0, M2.0-M2.1' }),
      task('plumbing_rough', 'Plumbing rough-in', 10, 'Plumbing', ['mep_layout'], { references: 'A2.0' }),
      task('hvac_rough', 'HVAC, mini-split, ERV and ventilation rough-in', 10, 'HVAC', ['mep_layout', 'fabricate_equipment'], { references: 'M0.3, M2.0-M2.1' }),
      task('electrical_rough', 'Electrical service and rough-in', 10, 'Electrical', ['mep_layout', 'fabricate_equipment'], { references: 'A3.0' }),
      task('low_voltage', 'Low-voltage, data and AV pre-wire', 4, 'Low Voltage', ['mep_layout']),
      task('rough_plumbing_inspection', 'INSPECTION - City rough plumbing', 1, 'City / Plumbing', ['plumbing_rough'], { type: 'inspection' }),
      task('rough_mech_inspection', 'INSPECTION - City rough mechanical', 1, 'City / HVAC', ['hvac_rough'], { type: 'inspection', references: 'M2.0-M2.1' }),
      task('rough_elec_inspection', 'INSPECTION - City rough electrical', 1, 'City / Electrical', ['electrical_rough', 'low_voltage'], { type: 'inspection' }),
      task('rough_corrections', 'Rough-in inspection correction allowance', 3, 'MEP / Framing', ['rough_plumbing_inspection', 'rough_mech_inspection', 'rough_elec_inspection'], { type: 'allowance' }),
      task('frame_inspection', 'INSPECTION - City framing, fireblocking & close-in', 1, 'City / Building', ['rough_corrections', 'shear_inspection'], { type: 'inspection', references: 'G2.0, S1.0' }),
    ],
  },
  {
    key: 'insulation', name: 'Insulation & Air Sealing', color: '#ffd60a', tasks: [
      task('air_sealing', 'Continuous air sealing and penetration sealing', 3, 'Insulation / GC', ['frame_inspection'], { references: 'G2.0-G2.1, A2.0' }),
      task('spray_foam', 'R-19 walls and R-50 roof/ceiling insulation', 5, 'Insulation', ['air_sealing'], { references: 'G3.0, A6.0-A6.2, HERS' }),
      task('city_insulation', 'INSPECTION - City thermal envelope insulation', 1, 'City / Energy', ['spray_foam'], { type: 'inspection', references: 'COBECC C105.2' }),
      task('hers_insulation', 'INSPECTION - HERS insulation before drywall', 1, 'HERS Rater', ['spray_foam'], { type: 'inspection', references: 'HERS report p. 1', notes: 'Mandatory visual inspection before any insulation is covered.' }),
      task('insulation_corrections', 'Air-sealing / insulation correction allowance', 2, 'Insulation', ['city_insulation', 'hers_insulation'], { type: 'allowance' }),
    ],
  },
  {
    key: 'drywall', name: 'Drywall & Interior Prep', color: '#ff6b6b', tasks: [
      task('drywall_hang', 'Hang drywall', 5, 'Drywall', ['insulation_corrections']),
      task('drywall_hold', 'INSPECTION - Drywall attachment hold point (if required)', 1, 'City / Building', ['drywall_hang'], { type: 'inspection' }),
      task('drywall_finish', 'Tape, mud, cure and sand', 10, 'Drywall', ['drywall_hold']),
      task('prime', 'Prime and seal interior surfaces', 3, 'Painter', ['drywall_finish']),
    ],
  },
  {
    key: 'interior', name: 'Interior Finishes', color: '#0a84ff', tasks: [
      task('cabinets', 'Install cabinetry and built-ins', 7, 'Cabinet Installer', ['prime', 'fabricate_cabinets'], { references: 'A2.0' }),
      task('tile_waterproof', 'Shower and wet-area waterproofing', 3, 'Tile', ['prime']),
      task('tile_inspection', 'INSPECTION - Shower pan / waterproofing', 1, 'City / Plumbing', ['tile_waterproof'], { type: 'inspection' }),
      task('tile_install', 'Bathroom and kitchen tile', 8, 'Tile', ['tile_inspection']),
      task('doors_trim', 'Interior doors, casing and finish trim', 10, 'Finish Carpentry', ['prime']),
      task('counter_template', 'Countertop field template', 1, 'Countertop Supplier', ['cabinets'], { type: 'procurement' }),
      task('counter_fabrication', 'Countertop fabrication', 10, 'Countertop Supplier', ['counter_template'], { type: 'procurement' }),
      task('counter_install', 'Install countertops', 2, 'Countertop Installer', ['counter_fabrication']),
      task('interior_paint', 'Interior finish paint', 8, 'Painter', ['doors_trim', 'cabinets']),
      task('wood_floor', 'Hardwood / resilient flooring', 7, 'Flooring', ['interior_paint']),
      task('carpet', 'Carpet installation', 2, 'Flooring', ['wood_floor']),
      task('finish_hardware', 'Finish carpentry, door hardware and accessories', 5, 'Finish Carpentry', ['carpet', 'counter_install']),
    ],
  },
  {
    key: 'final_mep', name: 'Final MEP & Equipment', color: '#bf5af2', tasks: [
      task('plumbing_trim', 'Plumbing fixtures and trim', 5, 'Plumbing', ['counter_install', 'tile_install', 'interior_paint']),
      task('electrical_trim', 'Electrical fixtures, devices and controls', 5, 'Electrical', ['interior_paint', 'wood_floor']),
      task('hvac_trim', 'HVAC equipment, grilles and controls', 5, 'HVAC', ['interior_paint'], { references: 'M0.3, M2.0-M2.1' }),
      task('appliances', 'Appliance installation and hookups', 2, 'Appliance / MEP', ['counter_install', 'plumbing_trim', 'electrical_trim']),
      task('glass_mirrors', 'Shower glass, mirrors and bath accessories', 3, 'Glass / Finish', ['tile_install', 'interior_paint']),
      task('tab_startup', 'HVAC startup, test and balance / ERV commissioning', 2, 'HVAC / TAB', ['hvac_trim'], { references: 'M0.1, M0.3' }),
    ],
  },
  {
    key: 'site_finish', name: 'Deck, Flatwork & Site Finish', color: '#32ade6', tasks: [
      task('deck', 'Rear deck, front porch and exterior steps', 7, 'Exterior Carpentry', ['backfill', 'siding'], { references: 'A1.0, A2.0, S2.2' }),
      task('final_grade', 'Final grading and positive drainage', 4, 'Sitework', ['gutters', 'deck', 'appliances'], { references: 'A1.0, soils pp. 8-9' }),
      task('flatwork', 'Concrete driveway, walks and exterior flatwork', 4, 'Concrete', ['final_grade'], { references: 'A1.0, soils pp. 6-8' }),
      task('exterior_lighting', 'Exterior lighting and devices', 2, 'Electrical', ['electrical_trim', 'final_grade']),
      task('landscape', 'Landscape, fence, gravel and site restoration', 7, 'Landscape', ['flatwork'], { references: 'L1.0, A1.0' }),
      task('drainage_hold', 'INSPECTION - Final drainage / erosion-control hold point', 1, 'GC / City', ['landscape', 'exterior_lighting'], { type: 'inspection', references: 'A1.0, soils p. 8' }),
    ],
  },
  {
    key: 'closeout', name: 'Testing, Final Inspections & Closeout', color: '#30d158', tasks: [
      task('hers_final', 'INSPECTION - Final HERS blower-door / energy certification', 1, 'HERS Rater', ['tab_startup', 'finish_hardware', 'appliances'], { type: 'inspection', references: 'HERS report p. 1' }),
      task('final_plumbing', 'INSPECTION - City final plumbing', 1, 'City / Plumbing', ['plumbing_trim', 'appliances'], { type: 'inspection' }),
      task('final_electrical', 'INSPECTION - City final electrical', 1, 'City / Electrical', ['electrical_trim', 'exterior_lighting'], { type: 'inspection' }),
      task('final_mechanical', 'INSPECTION - City final mechanical', 1, 'City / HVAC', ['tab_startup'], { type: 'inspection' }),
      task('punch', 'GC quality-control punch list', 5, 'All Trades', ['hers_final', 'final_plumbing', 'final_electrical', 'final_mechanical', 'drainage_hold']),
      task('final_corrections', 'Final correction and reinspection allowance', 3, 'All Trades', ['punch'], { type: 'allowance' }),
      task('building_final', 'INSPECTION - City final building', 1, 'City / Building', ['final_corrections'], { type: 'inspection' }),
      task('co', 'Certificate of Occupancy', 1, 'City / GC', ['building_final'], { type: 'milestone' }),
      task('final_clean', 'Final clean and turnover package', 2, 'Cleaning / GC', ['co']),
      task('walkthrough', 'Owner walkthrough / substantial completion', 1, 'Owner / GC', ['final_clean'], { type: 'milestone' }),
    ],
  },
]

export function buildJeffersonSchedule(projectStart = JEFFERSON_SCHEDULE_START) {
  const scheduleStart = normalizeWorkday(projectStart)
  const sources = JEFFERSON_PHASES.flatMap(phase => phase.tasks.map((item, taskIndex) => ({
    ...item,
    phaseKey: phase.key,
    phaseName: phase.name,
    phaseColor: phase.color,
    sort_order: taskIndex + 1,
  })))
  const plannedByKey = new Map()
  const pending = new Map(sources.map(item => [item.key, item]))

  while (pending.size) {
    let scheduledThisPass = 0
    for (const [key, item] of pending) {
      if (!item.dependsOn.every(dependencyKey => plannedByKey.has(dependencyKey))) continue
      const dependencyEnds = item.dependsOn.map(dependencyKey => plannedByKey.get(dependencyKey).end_date)
      const dependencyStart = dependencyEnds.length ? nextWorkday(maxDate(dependencyEnds)) : scheduleStart
      const notBefore = item.notBefore ? normalizeWorkday(item.notBefore) : scheduleStart
      const start = new Date(Math.max(dependencyStart, notBefore))
      const planned = {
        ...item,
        start_date: toDateString(start),
        end_date: toDateString(addWorkdays(start, item.duration - 1)),
        status: 'not_started',
      }
      plannedByKey.set(item.key, planned)
      pending.delete(key)
      scheduledThisPass++
    }
    if (!scheduledThisPass) {
      throw new Error(`Circular or missing schedule dependencies: ${[...pending.keys()].join(', ')}`)
    }
  }

  const phases = JEFFERSON_PHASES.map((phase, phaseIndex) => {
    const tasks = phase.tasks.map(item => plannedByKey.get(item.key))
    return {
      key: phase.key,
      name: phase.name,
      color: phase.color,
      sort_order: phaseIndex + 1,
      start_date: toDateString(minDate(tasks.map(item => item.start_date))),
      end_date: toDateString(maxDate(tasks.map(item => item.end_date))),
      status: 'not_started',
      tasks,
    }
  })

  return {
    projectStart: toDateString(scheduleStart),
    projectEnd: toDateString(maxDate(phases.map(phase => phase.end_date))),
    phases,
    tasks: phases.flatMap(phase => phase.tasks),
  }
}

const metadataByName = new Map(JEFFERSON_PHASES.flatMap(phase => phase.tasks.map(item => [item.name, item])))

export function getJeffersonTaskMetadata(name) {
  return metadataByName.get(name) || { trade: '', type: 'work', references: '', notes: '' }
}
