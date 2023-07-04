frappe.provide("stride");

frappe.pages["project-dashboard"].on_page_load = function (wrapper) {
    var page = frappe.ui.make_app_page({
        parent: wrapper,
        title: "Project Dashboard",
        single_column: false,
    });

    stride.employee_project_dashboard = new stride.EmployeeProjectDashboard(wrapper);
    $(wrapper).bind("show", function () {
        stride.employee_project_dashboard.show();
    });
};

stride.EmployeeProjectDashboard = class EmployeeProjectDashboard {
    constructor(wrapper) {
        this.wrapper = $(wrapper);
        this.page = wrapper.page;
        this.sidebar = this.wrapper.find(".layout-side-section");
        this.main_section = this.wrapper.find(".layout-main-section");
        this.sidebar_categories = ["Tools", "This Week Summary"];
        this.chart_widget_list = [];
        this.chart_widget_dict = {};
        this.tasks_dict = [];
    }
    show() {
        let route = frappe.get_route();
        this.user = frappe.user_info(frappe.session.user);
        this.setup_header();
        this.setup_sidebar();
        this.render_main_section();
    }

    setup_header() {
        this.page.set_title(__(this.page.title));
        this.setup_actions();
        this.add_project_filters();
    }

    setup_sidebar() {
        this.sidebar.empty().append(
            frappe.render_template("project_dashboard_sidebar", {
                fullname: this.user.fullname,
                designation: "UX Designer",
            })
        );
    }

    render_main_section() {
        this.main_section.append(frappe.render_template("project_dashboard"));
        this.render_assigned_tasks();
        this.get_project_overview_html();
        this.get_project_info_html();
        this.get_chart_widgets();
    }

    setup_actions() {
        this.page.add_inner_button(__("View Calendar"), () => {});
        this.page.add_inner_button(
            __("Adhoc Task"),
            () => {
                // ToDo:
            },
            __("Create")
        );

        this.page.add_inner_button(
            __("Item 2"),
            () => {
                // ToDo:
            },
            __("Create")
        );
        this.page.set_inner_btn_group_as_primary("Create");

        this.wrapper.find(".card-options.project-notes btn").on("click", () => {
            frappe.new_doc("Project Note");
        });
    }

    add_project_filters() {
        if (this.page.page_form.find(".frappe-control").length > 0) return;

        const me = this;
        this.filter = this.page.add_field({
            label: "Project",
            fieldtype: "Link",
            fieldname: "project",
            options: "Project",
            change() {
                me.project = me.filter.get_value();
                me.get_project_overview_html();
                me.get_project_info_html();
                me.refresh_chart_widgets();
            },
        });
        this.project = this.filter.get_value();
        $(this.filter.wrapper).removeClass("col-md-2").addClass("col-md-3");
    }

    render_assigned_tasks() {
        const me = this;
        frappe.call({
            method: "stride_projects.stride_projects.page.project_dashboard.project_dashboard.get_assigned_tasks",
            args: {
                project: this.project,
            },
            callback: function (r) {
                if (!r.message) return;
                const tasks = r.message;
                console.log(tasks);
                me.tasksWidget = new stride.TasksWidget({
					container: me.wrapper.find(".assigned-tasks .row-wrapper.container"),
					tasks: tasks,
				});
				me.tasksWidget.columns.forEach(column => {
					this.tasks_dict[column.task_status] = { tasks: column.tasks };
				});
            },
        });
    }

    get_project_overview_html() {
        const me = this;
        const project_row = this.wrapper.find(".row.project-overview");
        if (!this.project) return project_row.addClass("hidden");
        frappe.call({
            method: "stride_projects.stride_projects.doctype.project.project.get_all_milestones_html",
            args: {
                document: this.project,
                milestone_dashboard_filter: "",
            },
            callback: function (r) {
                if (!r.message) return;
                project_row.removeClass("hidden");
                me.wrapper
                    .find(".chart-wrapper.project-overview")
                    .empty()
                    .append(r.message);
            },
        });
    }

    get_project_info_html() {
        const me = this;
        const project_row = this.wrapper.find(".row.project-info");
        if (!this.project) return project_row.addClass("hidden");
        frappe.call({
            method: "stride_projects.stride_projects.doctype.project.project.get_users_html",
            args: {
                document: this.project,
            },
            callback: function (r) {
                if (!r.message) return;
                project_row.removeClass("hidden");
                me.wrapper.find(".project-info.team-info").empty().append(r.message);
            },
        });
        frappe.call({
            method: "stride_projects.stride_projects.doctype.project.project.get_project_links_html",
            args: {
                document: this.project,
            },
            callback: function (r) {
                if (!r.message) return;
                project_row.removeClass("hidden");
                me.wrapper.find(".project-info.link-info").empty().append(r.message);
            },
        });
    }

    get_chart_widgets() {
        const charts = [
            {
                chart_name: "Completed Tasks",
                width: "Full",
                container: this.wrapper.find(".project-charts.col-md-8"),
            },
            {
                chart_name: "Tasks Breakdown",
                width: "Full",
                container: this.wrapper.find(".project-charts.col-md-4"),
            },
        ];

        charts.forEach(chart => {
            let widget = frappe.widget.make_widget({
                ...chart,
                label: chart.chart_name,
                options: {},
                widget_type: "chart",
            });

            this.chart_widget_list.push(widget);
            this.chart_widget_dict[chart.chart_name] = widget;
        });

        this.wrapper.find(".row.project-charts").removeClass("hidden");
    }

    refresh_chart_widgets() {
        this.chart_widget_list.forEach(widget => {
            if (!this.project) delete widget.filters.project;
            else widget.filters.project = this.project;

            widget.save_chart_config_for_user({ filters: widget.filters });
            widget.fetch_and_update_chart();
        });
    }
};

stride.TasksWidget = class TasksWidget {
    constructor(opts) {
        $.extend(this, opts);
        this.columns = new Map([
            [
                "Draft",
                {
                    columnName: "Backlog",
                    nextAction: "To Do",
                    tasks: [],
                    task_status: "backlog",
                },
            ],
            [
                "ToDo",
                {
                    columnName: "To Do",
                    nextAction: "In Progress",
                    tasks: [],
                    task_status: "todo",
                },
            ],
            [
                "In Progress",
                {
                    columnName: "In Progress",
                    nextAction: "Done",
                    tasks: [],
                    task_status: "in_progress",
                },
            ],
        ]);
        this.show();
    }

    show() {
        this.container.append(`<div class="row task-widget"></div>`);

        const PRIORITIES = {
            High: "#cf3636",
            Low: "",
            Medium: "darkgoldenrod",
        };
        const columnContainer = this.container.find(".row");

        this.tasks.forEach(task => {
			task.createdSince = frappe.datetime.comment_when(task.creation);
			if (task.expected_time) {
				let expected_time_formatted = frappe.utils.seconds_to_duration(task.expected_time);
				task.expected_time_formatted = `${expected_time_formatted.days}d ${expected_time_formatted.hours}h ${expected_time_formatted.minutes}m`;
			}
            task.priorityColour = PRIORITIES[task.priority];
			task.expected_end_date = frappe.datetime.str_to_user(task.expected_end_date);
            const column = this.columns.get(task.status);
            if (column) {
                stride[column.task_status] = { tasks: column.tasks };
                task.nextAction = column.nextAction;
                column.tasks.push(task);
            }
        });

        this.columns.forEach(column => {
            const taskColumn = new stride.TaskColumn(columnContainer);
            taskColumn.show(column.columnName, column.tasks);
        });
    }
};

stride.TaskColumn = class TaskColumn {
    constructor(container) {
        this.container = container;
    }

    show(title, tasks) {
        let totalTime = 0;
        const TASK_STATUS = {
            "Backlog": "backlog",
            "To Do": "to-do",
            "In Progress": "in-progress",
        };
        tasks.forEach(task => {
            if (task.expected_time) {
                totalTime += parseInt(task.expected_time);
            }
        });
		totalTime = frappe.utils.seconds_to_duration(totalTime);
		totalTime = `${totalTime.days}d ${totalTime.hours}h ${totalTime.minutes}m`;
        this.container.append(
            frappe.render_template("task_column", {
                column_title: title,
                totalTime: totalTime,
                totalTasks: tasks.length,
                status: TASK_STATUS[title],
            })
        );

        tasks.forEach(task => {
            const cardContainer = this.container.find(
                `.task-column.${TASK_STATUS[title]} .column-tasks`
            );
            const card = new stride.TaskCard({ container: cardContainer, task });
        });
    }
};

stride.TaskCard = class TaskCard {
    constructor(opts) {
        $.extend(this, opts);
        this.show();
    }

    show() {
        this.container.append(frappe.render_template("task_card", { task: this.task }));
    }
};

function toggleIcon() {
    var sortIcon = document.getElementById(`sortIcon`);
    var currentIcon = sortIcon.getAttribute("href");
    if (currentIcon === "#icon-sort-ascending") {
        sortIcon.setAttribute("href", "#icon-sort-descending");
		console.log("descending");
    } else {
        sortIcon.setAttribute("href", "#icon-sort-ascending");
		console.log("ascending");
    }
}

function selectOption(option) {
    var option_field = document.getElementById(`selectedOption`);
    option_field.textContent = option;
	console.log(option);
}

function changeStatus(task_name) {
	console.log(task_name);
}