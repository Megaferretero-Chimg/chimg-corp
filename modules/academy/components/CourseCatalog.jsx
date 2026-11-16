"use client";

import { BookOpen, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import SelectInput from "@/components/ui/SelectInput";
import { ACADEMY_COURSES_PATH } from "@/modules/academy/module";
import adminStyles from "@/modules/academy/styles/admin.module.scss";
import styles from "@/modules/academy/styles/catalog.module.scss";

function normalizeSearch(text) {
  return (text ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es").trim();
}

export default function CourseCatalog({ courses, roles }) {
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");
  const term = normalizeSearch(search);
  const results = courses.filter((course) =>
    (!role || course.roleIds.includes(role)) &&
    (!status || course.status === status) &&
    (!term || [course.title, course.description].some((text) => normalizeSearch(text).includes(term))),
  );

  return (
    <section className={styles.catalog} aria-label="Catálogo de cursos">
      <div className={styles.toolbar}>
        <label className={styles.search}>
          Buscar cursos
          <span>
            <Search size={17} aria-hidden="true" />
            <input type="search" placeholder="Título o descripción" value={search} onChange={(event) => setSearch(event.target.value)} />
          </span>
        </label>
        <SelectInput className={styles.filter} controlClassName={styles.filterControl} label="Cargo asignado" value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="">Todos los cargos</option>
          {roles.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
        </SelectInput>
        <SelectInput className={styles.filter} controlClassName={styles.filterControl} label="Estado" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">Todos los estados</option>
          <option value="draft">Borrador</option>
          <option value="published">Publicado</option>
        </SelectInput>
        <Link className={adminStyles.primary} href={`${ACADEMY_COURSES_PATH}?edit=new`} scroll={false}>
          <Plus size={17} aria-hidden="true" /> Crear curso
        </Link>
      </div>

      <p className={styles.resultCount} role="status">{results.length} de {courses.length} cursos</p>

      {results.length > 0 ? (
        <ul className={styles.grid}>
          {results.map((course) => {
            const isPublished = course.status === "published";

            return (
              <li key={course.id}>
                <Link className={styles.card} href={`${ACADEMY_COURSES_PATH}?edit=${course.id}`} aria-label={`Abrir curso ${course.title}`}>
                  <div className={styles.cardHeader}>
                    <span className={styles.icon}><BookOpen size={20} aria-hidden="true" /></span>
                    <span className={styles.status} data-published={isPublished}>{isPublished ? "Publicado" : "Borrador"}</span>
                  </div>
                  <div>
                    <p className={styles.type}>{course.category}</p>
                    <h2>{course.title}</h2>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className={styles.empty}>
          <h2>{courses.length ? "Sin resultados" : "Aún no hay cursos"}</h2>
          <p>{courses.length ? "Prueba otra búsqueda o ajusta los filtros." : "Crea el primer curso para empezar a preparar su contenido."}</p>
          {courses.length > 0 && (
            <button type="button" onClick={() => { setSearch(""); setRole(""); setStatus(""); }}>Limpiar filtros</button>
          )}
        </div>
      )}
    </section>
  );
}
