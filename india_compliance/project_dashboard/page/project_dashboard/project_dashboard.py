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