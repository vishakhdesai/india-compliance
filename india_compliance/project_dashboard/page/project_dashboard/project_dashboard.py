import frappe


@frappe.whitelist()
def get_assigned_tasks(project=None):
    filters = {
        "project_activity_type": "Task",
        "_assign": ["like", f'%"{frappe.session.user}"%'],
    }

    if project == "None":
        project = ["is", "not set"]

    if project:
        filters["project"] = project

    return frappe.db.get_all(
        "Project Activity",
        fields=[
            "name",
            "title",
            "status",
            "priority",
            "creation",
            "expected_end_date",
            "expected_time",
        ],
        filters=filters,
    )


@frappe.whitelist()
def update_task_status(task=None, status=None):
    frappe.db.set_value("Project Activity", task, "status", status)
    return True


@frappe.whitelist()
def get_user_projects():
    project = frappe.qb.DocType("Project")
    project_team = frappe.qb.DocType("Project Team")

    projects = (
        frappe.qb.from_(project)
        .select(project.name, project.project_name, project.status, project.priority)
        .join(project_team)
        .on(project.name == project_team.parent)
        .where(project.status.notin(["Completed", "Cancelled"]))
        .where(project_team.user == frappe.session.user)
        .where(project_team.is_active == 1)
        .run(as_dict=True)
    )

    user_projects = [
        {
            "label": project.project_name,
            "value": project.name,
            "description": f"{project.name}, {project.status}, {project.priority}",
        }
        for project in projects
    ]

    all_none_options = [
        {"label": "", "value": "None"},
        {"label": "All Projects", "value": "All Projects"},
    ]

    return all_none_options + user_projects


@frappe.whitelist()
def get_project_notes(project=None):
    filters = {"is_completed": 0}
    if project:
        filters["project"] = project

    return frappe.get_list("Project Note", fields="*", filters=filters)


@frappe.whitelist()
def mark_note_as_completed(note_name):
    return frappe.get_doc("Project Note", note_name).update({"is_completed": 1}).save()
