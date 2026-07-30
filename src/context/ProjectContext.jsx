import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { buildActionItems, calculateProjectMetrics, createProjectModel } from '../domain/project.js'
import { getJeffersonTaskMetadata } from '../data/jeffersonSchedule.js'
import { COLLECTION_SPECS, createProjectRepository } from '../lib/projectRepository.js'
import { supabase } from '../lib/supabase.js'

const ProjectContext = createContext(null)
const EMPTY_COLLECTIONS = Object.fromEntries(Object.keys(COLLECTION_SPECS).map(key => [key, []]))
const REQUIRED_KEYS = Object.entries(COLLECTION_SPECS).filter(([, spec]) => !spec.optional).map(([key]) => key)
const OPTIONAL_KEYS = Object.entries(COLLECTION_SPECS).filter(([, spec]) => spec.optional).map(([key]) => key)
let initialRequiredLoad = null

export function ProjectProvider({ children }) {
  const repository = useMemo(() => createProjectRepository(supabase), [])
  const [collections, setCollections] = useState(EMPTY_COLLECTIONS)
  const [loading, setLoading] = useState(true)
  const [loadingCollections, setLoadingCollections] = useState({})
  const [availability, setAvailability] = useState({})
  const [errors, setErrors] = useState({})

  const loadCollections = useCallback(async (keys = Object.keys(COLLECTION_SPECS)) => {
    setLoadingCollections(previous => ({ ...previous, ...Object.fromEntries(keys.map(key => [key, true])) }))
    const results = await repository.loadCollections(keys)
    setCollections(previous => ({
      ...previous,
      ...Object.fromEntries(keys.map(key => [key, results[key].data])),
    }))
    setAvailability(previous => ({
      ...previous,
      ...Object.fromEntries(keys.map(key => [key, results[key].available])),
    }))
    setErrors(previous => ({
      ...previous,
      ...Object.fromEntries(keys.map(key => [key, results[key].error || null])),
    }))
    setLoadingCollections(previous => ({ ...previous, ...Object.fromEntries(keys.map(key => [key, false])) }))
    return results
  }, [repository])

  useEffect(() => {
    let active = true
    initialRequiredLoad ||= repository.loadCollections(REQUIRED_KEYS)
    initialRequiredLoad.then(results => {
      if (!active) return
      setCollections(previous => ({ ...previous, ...Object.fromEntries(Object.entries(results).map(([key, result]) => [key, result.data])) }))
      setAvailability(previous => ({ ...previous, ...Object.fromEntries(Object.entries(results).map(([key, result]) => [key, result.available])) }))
      setErrors(previous => ({ ...previous, ...Object.fromEntries(Object.entries(results).map(([key, result]) => [key, result.error || null])) }))
      setLoading(false)
      repository.loadCollections(OPTIONAL_KEYS).then(optionalResults => {
        if (!active) return
        setCollections(previous => ({ ...previous, ...Object.fromEntries(Object.entries(optionalResults).map(([key, result]) => [key, result.data])) }))
        setAvailability(previous => ({ ...previous, ...Object.fromEntries(Object.entries(optionalResults).map(([key, result]) => [key, result.available])) }))
        setErrors(previous => ({ ...previous, ...Object.fromEntries(Object.entries(optionalResults).map(([key, result]) => [key, result.error || null])) }))
      })
    })
    return () => { active = false }
  }, [repository])

  const setCollection = useCallback((key, nextValue) => {
    setCollections(previous => ({
      ...previous,
      [key]: typeof nextValue === 'function' ? nextValue(previous[key] || []) : nextValue,
    }))
  }, [])

  const recordEvent = useCallback(async event => {
    const row = {
      project_id: collections.projects[0]?.id || null,
      event_type: event.type,
      entity_type: event.entityType || null,
      entity_id: event.entityId || null,
      summary: event.summary,
      metadata: event.metadata || {},
      occurred_at: new Date().toISOString(),
    }
    if (availability.projectEvents) {
      try {
        const saved = await repository.create('projectEvents', row)
        setCollection('projectEvents', previous => [saved, ...previous].slice(0, 100))
        return saved
      } catch {
        // A project mutation must not fail because its audit event could not be recorded.
      }
    }
    const local = { ...row, id: `local-${Date.now()}-${Math.random().toString(16).slice(2)}` }
    setCollection('projectEvents', previous => [local, ...previous].slice(0, 100))
    return local
  }, [availability.projectEvents, collections.projects, repository, setCollection])

  const createEntity = useCallback(async (key, values, event) => {
    const saved = await repository.create(key, values)
    setCollection(key, previous => [saved, ...previous])
    await recordEvent(event || {
      type: `${key}.created`, entityType: key, entityId: saved.id,
      summary: `Created ${saved.name || saved.description || saved.item_description || key}`,
    })
    return saved
  }, [repository, setCollection, recordEvent])

  const updateEntity = useCallback(async (key, id, patch, event) => {
    const saved = await repository.update(key, id, patch)
    setCollection(key, previous => previous.map(item => item.id === id ? saved : item))
    await recordEvent(event || {
      type: `${key}.updated`, entityType: key, entityId: id,
      summary: `Updated ${saved.name || saved.description || saved.item_description || key}`,
    })
    return saved
  }, [repository, setCollection, recordEvent])

  const removeEntity = useCallback(async (key, id, event) => {
    const existing = collections[key]?.find(item => item.id === id)
    await repository.remove(key, id)
    setCollection(key, previous => previous.filter(item => item.id !== id))
    await recordEvent(event || {
      type: `${key}.deleted`, entityType: key, entityId: id,
      summary: `Deleted ${existing?.name || existing?.description || existing?.item_description || key}`,
    })
  }, [collections, repository, setCollection, recordEvent])

  const model = useMemo(() => createProjectModel(collections, { taskMetadataFor: getJeffersonTaskMetadata }), [collections])
  const metrics = useMemo(() => calculateProjectMetrics(model), [model])
  const actions = useMemo(() => buildActionItems(model, metrics), [model, metrics])
  const requiredErrors = Object.entries(errors).filter(([key, error]) => error && !COLLECTION_SPECS[key].optional)
  const connection = loading ? 'connecting' : requiredErrors.length ? 'degraded' : 'live'

  const value = useMemo(() => ({
    collections,
    model,
    metrics,
    actions,
    loading,
    loadingCollections,
    availability,
    errors,
    connection,
    setCollection,
    refresh: loadCollections,
    repository,
    supabase,
    createEntity,
    updateEntity,
    removeEntity,
    recordEvent,
  }), [collections, model, metrics, actions, loading, loadingCollections, availability, errors, connection, setCollection, loadCollections, repository, createEntity, updateEntity, removeEntity, recordEvent])

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>
}

export function useProject() {
  const context = useContext(ProjectContext)
  if (!context) throw new Error('useProject must be used inside ProjectProvider')
  return context
}

export function useProjectCollection(key) {
  const project = useProject()
  const setValue = useCallback(nextValue => project.setCollection(key, nextValue), [project, key])
  const refresh = useCallback(() => project.refresh([key]), [project, key])
  return [
    project.collections[key] || [],
    setValue,
    project.loading || project.loadingCollections[key] || false,
    refresh,
  ]
}
