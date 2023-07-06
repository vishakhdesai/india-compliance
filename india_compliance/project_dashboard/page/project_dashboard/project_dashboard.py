import frappe

@frappe.whitelist()
def get_assigned_tasks(project=None):
    return frappe.db.get_all(
        "Project Activity",
        fields="*",
        filters={
            "project_activity_type": "Task",
        },
    )


@frappe.whitelist()
def get_project_notes(project=None):
    return frappe.db.get_all("Project Note", fields="*", filters={"is_completed": 0})

@frappe.whitelist()
def mark_note_as_completed(note_name):
    return frappe.get_doc("Project Note", note_name).update({"is_completed": 1}).save()